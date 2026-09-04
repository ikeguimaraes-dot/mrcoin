import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { PrismaService } from '../../prisma/prisma.service';
import { hashCpf } from '../../common/crypto/cpf-crypto.util';
import { REDIS_CLIENT } from '../../common/redis/redis.constants';
import { verifyPassword } from '../auth/password.util';
import { LoginInput } from './dto/login.schema';
import { InvalidLoginCredentialsException } from './exceptions/invalid-login-credentials.exception';
import { LoginLockedException } from './exceptions/login-locked.exception';
import { RequestMeta, UserTokenPair, UserTokenService } from './user-token.service';

const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCKOUT_WINDOW_SECONDS = 900;

/**
 * Hash argon2id fixo, pré-gerado uma vez (nunca de um segredo real) — usado como alvo de
 * verifyPassword quando o CPF não existe ou a conta ainda não tem senha, só pra manter o
 * custo de CPU (e logo o tempo de resposta) igual ao caso de senha errada de verdade. Nunca
 * recalculado por request: o ponto é amortizar o custo do argon2, não gerar salt novo.
 */
const DUMMY_PASSWORD_HASH = '$argon2id$v=19$m=65536,p=4,t=3$Mcq6TSTMHoQuXQUP+QYQPw$jIWZq/5NgMj3iRpJtuE63EHzMVh62R//ozhlHtEJGZc';

/**
 * Login por CPF+senha, síncrono — sem OTP no caminho feliz (OTP agora só em
 * PasswordRecoveryService). Anti-enumeração: CPF inexistente, CPF sem senha, conta não-ACTIVE
 * e senha errada precisam ser indistinguíveis na resposta E no tempo — por isso verifyPassword
 * é SEMPRE chamado (contra um hash real ou o DUMMY_PASSWORD_HASH), nunca pulado por um
 * short-circuit como o AuthService.login de AdminUser faz hoje (desvio deliberado desse
 * precedente, não um descuido).
 *
 * Bloqueio fixo (espelha TransactionPinService.verifyPin) chaveado por hashCpf — não por
 * userId, já que aqui ainda não se sabe se existe usuário — o que faz um CPF inventado travar
 * exatamente igual a um real, sem vazar existência também nessa resposta.
 */
@Injectable()
export class LoginService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userTokenService: UserTokenService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async login(input: LoginInput, meta: RequestMeta = {}): Promise<UserTokenPair> {
    const cpfHash = hashCpf(input.cpf);
    const lockKey = `login-fail:${cpfHash}`;

    const currentFailures = await this.redis.get(lockKey);
    if (currentFailures !== null && Number(currentFailures) >= LOGIN_MAX_ATTEMPTS) {
      throw new LoginLockedException();
    }

    const user = await this.prisma.user.findUnique({ where: { cpfHash } });
    const hashToVerify = user?.passwordHash ?? DUMMY_PASSWORD_HASH;
    const passwordValid = await verifyPassword(hashToVerify, input.password);

    if (user && user.status === 'ACTIVE' && user.passwordHash && passwordValid) {
      await this.redis.del(lockKey);
      return this.userTokenService.issueTokenPair(user.id, meta);
    }

    const newCount = await this.redis.incr(lockKey);
    if (newCount === 1) {
      await this.redis.expire(lockKey, LOGIN_LOCKOUT_WINDOW_SECONDS);
    }
    if (newCount >= LOGIN_MAX_ATTEMPTS) {
      throw new LoginLockedException();
    }
    throw new InvalidLoginCredentialsException();
  }
}
