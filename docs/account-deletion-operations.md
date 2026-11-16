# Atendimento de exclusão de conta e desligamento

## Prazo e fila

O titular confirma o pedido dentro do aplicativo em Perfil → Excluir minha conta, usando sua senha. O pedido aceita saldo positivo, produz um protocolo e tem prazo de sete dias corridos. Repetições preservam o protocolo e o prazo original.

A operação da plataforma deve acompanhar a fila diariamente e priorizar prazos vencidos. O painel em `coins-platform-front.vercel.app/exclusoes` utiliza os endpoints autenticados abaixo; a publicação do painel e da API precisa estar concluída antes de divulgar a funcionalidade.

- `GET /platform/account-deletion-requests`: pendentes de conclusão ou confirmação por e-mail, em páginas de até 50 itens.
- `GET /platform/account-deletion-requests/:id`: conta, carteiras, quantidade de registros de operações e resgates pendentes para revisão.
- `POST /platform/account-deletion-requests/:id/complete`: conclui o atendimento com `confirmReview: true` e `retentionReason` entre 20 e 2.000 caracteres.

Essas rotas exigem o JWT dedicado do administrador da plataforma. Usuários, parceiros e administradores de empresas não podem utilizá-las.

## Revisão antes de concluir

Confira a identidade associada ao protocolo, os benefícios com entrega pendente e quais registros precisam ser conservados. A justificativa deve especificar categorias, finalidade e período ou critério de conservação do caso real; ela será enviada ao titular. Não use justificativa genérica para conservar dados sem necessidade.

O serviço conserva o histórico de operações e sua integridade. Descrições antigas do extrato podem conter nomes de participantes; isso também deve ser considerado na revisão de necessidade de conservação. Se o caso exigir remoção adicional desses registros, encaminhe o tratamento específico antes de marcar o atendimento como concluído. Nunca altere uma cadeia de hashes ou apague movimentações para simular atendimento de privacidade.

Informe ao titular como atender benefícios já resgatados sem impedir o pedido de exclusão. Não exija saldo zero. Sair da empresa não equivale a excluir a conta e não pode ser utilizado para confiscar saldo.

## O que a conclusão faz

Em uma transação, o serviço remove sessões e dispositivos, solicitações antigas de cadastro/recuperação, credenciais e contatos; substitui a identificação da conta; limpa dados auxiliares de distribuição e progresso de cursos; bloqueia seus vínculos; e libera reservas de giros ainda não utilizados. O histórico de operações permanece, sem débito ou zeragem direta de carteira. Uma auditoria registra o operador e o protocolo.

A conta fica em estado `DELETED`. JWTs antigos deixam de autenticar imediatamente na próxima requisição. O login e a recuperação de senha não reativam a conta excluída.

Depois da transação, o serviço tenta enviar a confirmação por e-mail, incluindo a justificativa de conservação. Se o provedor falhar, o pedido permanece visível como confirmação pendente. Repetir a conclusão de um pedido já processado apenas tenta reenviar esse aviso, sem executar a remoção novamente. O endereço de aviso temporário é limpo após envio bem-sucedido.

Se um backup for restaurado, reaplique os atendimentos de exclusão posteriores ao ponto restaurado antes de liberar o serviço. Verifique também dados exportados ou mantidos fora deste banco conforme a política e as obrigações do caso.

## Desligamento da empresa

`POST /admin/members/:membershipId/departure`, restrito a OWNER/MANAGER da própria empresa, registra `departedAt` sem alterar saldo nem tornar o vínculo `INACTIVE`. Saldo, extrato, saída de coins e resgate permanecem disponíveis.

Distribuições individuais/CSV, concessão e resgate de giros, créditos de cursos e recebimento de transferências deixam de gerar novos coins para esse vínculo. A validação transacional é serializada com o desligamento. Vínculos `INACTIVE` continuam bloqueados: este endpoint não os libera e não migra automaticamente usuários existentes.

## Publicação

A migração `20261116120000_account_deletion_and_departure` é aditiva: cria a fila e o campo de saída, sem alterar usuários ou saldos existentes. O Dockerfile executa `prisma migrate deploy` antes de iniciar a API. Confirme o resultado da migração, o contrato OpenAPI e o endpoint de saúde no ambiente publicado antes de disponibilizar a nova build do app.
