import { Body, Controller, Get, Headers, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserJwtGuard } from '../../common/guards/user-jwt.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { UserJwtPayload } from '../../common/guards/jwt-payload.types';
import { requireIdempotencyKey } from '../../common/http/require-idempotency-key.util';
import { CoursesService } from './courses.service';
import { OrganizationQueryDto, organizationQuerySchema } from './dto/organization-query.schema';
import { CompleteLessonDto, completeLessonSchema } from './dto/complete-lesson.schema';
import { SubmitQuizDto, submitQuizSchema } from './dto/submit-quiz.schema';
import { ListCoursesResponseDto } from './dto/list-courses-response.schema';
import { CourseDetailResponseDto } from './dto/course-detail-response.schema';
import { CompleteLessonResponseDto } from './dto/complete-lesson-response.schema';
import { QuizResponseDto } from './dto/quiz-response.schema';
import { SubmitQuizResponseDto } from './dto/submit-quiz-response.schema';

@ApiTags('courses')
@Controller('courses')
@UseGuards(UserJwtGuard)
export class CoursesController {
  constructor(private readonly coursesService: CoursesService) {}

  @Get()
  @ApiOperation({ summary: 'Lista os cursos publicados com o progresso do usuário' })
  @ApiOkResponse({ type: ListCoursesResponseDto })
  list(@CurrentUser() user: UserJwtPayload, @Query(new ZodValidationPipe(organizationQuerySchema)) query: OrganizationQueryDto) {
    return this.coursesService.listCourses(user.sub, query.organizationId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalhe de um curso — aulas e estado do quiz' })
  @ApiOkResponse({ type: CourseDetailResponseDto })
  getById(
    @CurrentUser() user: UserJwtPayload,
    @Param('id') id: string,
    @Query(new ZodValidationPipe(organizationQuerySchema)) query: OrganizationQueryDto,
  ) {
    return this.coursesService.getCourseDetail(user.sub, query.organizationId, id);
  }

  @Post(':id/lessons/:lessonId/complete')
  @ApiOperation({ summary: 'Marca uma aula como assistida' })
  @ApiOkResponse({ type: CompleteLessonResponseDto })
  completeLesson(
    @CurrentUser() user: UserJwtPayload,
    @Param('id') id: string,
    @Param('lessonId') lessonId: string,
    @Body(new ZodValidationPipe(completeLessonSchema)) body: CompleteLessonDto,
  ) {
    return this.coursesService.completeLesson(user.sub, body.organizationId, id, lessonId);
  }

  @Get(':id/quiz')
  @ApiOperation({ summary: 'Questões e alternativas do quiz — nunca indica a correta' })
  @ApiOkResponse({ type: QuizResponseDto })
  getQuiz(
    @CurrentUser() user: UserJwtPayload,
    @Param('id') id: string,
    @Query(new ZodValidationPipe(organizationQuerySchema)) query: OrganizationQueryDto,
  ) {
    return this.coursesService.getQuiz(user.sub, query.organizationId, id);
  }

  @Post(':id/quiz/submit')
  @ApiOperation({ summary: 'Corrige o quiz no servidor — se aprovado, credita os coins' })
  @ApiCreatedResponse({ type: SubmitQuizResponseDto })
  submitQuiz(
    @CurrentUser() user: UserJwtPayload,
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(submitQuizSchema)) body: SubmitQuizDto,
  ) {
    return this.coursesService.submitQuiz(user.sub, body.organizationId, id, body, requireIdempotencyKey(idempotencyKey));
  }
}
