import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { PlatformAdminAuth } from '../decorators/platform-admin-auth.decorator';
import { CurrentPlatformAdmin } from '../decorators/current-platform-admin.decorator';
import { PlatformAdminJwtPayload } from '../../../common/guards/jwt-payload.types';
import { PlatformCoursesService } from './platform-courses.service';
import { CreateCourseDto, createCourseSchema } from './dto/create-course.schema';
import { UpdateCourseDto, updateCourseSchema } from './dto/update-course.schema';
import { ListPlatformCoursesQueryDto, listPlatformCoursesQuerySchema } from './dto/list-courses-query.schema';
import { CourseDetailAdminDto, CourseListResponseDto, CourseSummaryDto } from './dto/course-response.schema';
import { CreateLessonDto, createLessonSchema } from './dto/create-lesson.schema';
import { UpdateLessonDto, updateLessonSchema } from './dto/update-lesson.schema';
import { QuizQuestionDto, quizQuestionSchema } from './dto/quiz-question.schema';

@ApiTags('platform-courses')
@Controller('platform/courses')
export class PlatformCoursesController {
  constructor(private readonly coursesService: PlatformCoursesService) {}

  @Post()
  @PlatformAdminAuth()
  @ApiOperation({ summary: 'Cria um curso (nasce em rascunho)' })
  @ApiOkResponse({ type: CourseSummaryDto })
  create(
    @Body(new ZodValidationPipe(createCourseSchema)) body: CreateCourseDto,
    @CurrentPlatformAdmin() platformAdmin: PlatformAdminJwtPayload,
    @Req() request: Request,
  ) {
    return this.coursesService.create(platformAdmin.sub, body, request.ip);
  }

  @Get()
  @PlatformAdminAuth()
  @ApiOperation({ summary: 'Lista todos os cursos (qualquer status), paginado, com filtro opcional por status' })
  @ApiOkResponse({ type: CourseListResponseDto })
  list(@Query(new ZodValidationPipe(listPlatformCoursesQuerySchema)) query: ListPlatformCoursesQueryDto) {
    return this.coursesService.list(query);
  }

  @Get(':id')
  @PlatformAdminAuth()
  @ApiOperation({ summary: 'Detalhe do curso com aulas e quiz (incluindo qual alternativa é a correta)' })
  @ApiOkResponse({ type: CourseDetailAdminDto })
  getById(@Param('id') id: string) {
    return this.coursesService.getById(id);
  }

  @Patch(':id')
  @PlatformAdminAuth()
  @ApiOperation({ summary: 'Atualiza título/descrição/capa/ordem/status — publicar é só status: PUBLISHED' })
  @ApiOkResponse({ type: CourseSummaryDto })
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateCourseSchema)) body: UpdateCourseDto,
    @CurrentPlatformAdmin() platformAdmin: PlatformAdminJwtPayload,
    @Req() request: Request,
  ) {
    return this.coursesService.update(platformAdmin.sub, id, body, request.ip);
  }

  @Post(':id/lessons')
  @PlatformAdminAuth()
  @ApiOperation({ summary: 'Adiciona uma aula ao curso' })
  addLesson(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createLessonSchema)) body: CreateLessonDto,
    @CurrentPlatformAdmin() platformAdmin: PlatformAdminJwtPayload,
    @Req() request: Request,
  ) {
    return this.coursesService.addLesson(platformAdmin.sub, id, body, request.ip);
  }

  @Patch(':id/lessons/:lessonId')
  @PlatformAdminAuth()
  @ApiOperation({ summary: 'Atualiza uma aula' })
  updateLesson(
    @Param('id') id: string,
    @Param('lessonId') lessonId: string,
    @Body(new ZodValidationPipe(updateLessonSchema)) body: UpdateLessonDto,
    @CurrentPlatformAdmin() platformAdmin: PlatformAdminJwtPayload,
    @Req() request: Request,
  ) {
    return this.coursesService.updateLesson(platformAdmin.sub, id, lessonId, body, request.ip);
  }

  @Delete(':id/lessons/:lessonId')
  @PlatformAdminAuth()
  @ApiOperation({ summary: 'Remove uma aula do curso' })
  removeLesson(
    @Param('id') id: string,
    @Param('lessonId') lessonId: string,
    @CurrentPlatformAdmin() platformAdmin: PlatformAdminJwtPayload,
    @Req() request: Request,
  ) {
    return this.coursesService.removeLesson(platformAdmin.sub, id, lessonId, request.ip);
  }

  @Post(':id/quiz/questions')
  @PlatformAdminAuth()
  @ApiOperation({ summary: 'Adiciona uma questão ao quiz do curso (cria o quiz se ainda não existir)' })
  addQuestion(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(quizQuestionSchema)) body: QuizQuestionDto,
    @CurrentPlatformAdmin() platformAdmin: PlatformAdminJwtPayload,
    @Req() request: Request,
  ) {
    return this.coursesService.addQuestion(platformAdmin.sub, id, body, request.ip);
  }

  @Patch(':id/quiz/questions/:questionId')
  @PlatformAdminAuth()
  @ApiOperation({ summary: 'Atualiza uma questão — substitui o conjunto de alternativas inteiro' })
  updateQuestion(
    @Param('id') id: string,
    @Param('questionId') questionId: string,
    @Body(new ZodValidationPipe(quizQuestionSchema)) body: QuizQuestionDto,
    @CurrentPlatformAdmin() platformAdmin: PlatformAdminJwtPayload,
    @Req() request: Request,
  ) {
    return this.coursesService.updateQuestion(platformAdmin.sub, id, questionId, body, request.ip);
  }

  @Delete(':id/quiz/questions/:questionId')
  @PlatformAdminAuth()
  @ApiOperation({ summary: 'Remove uma questão do quiz' })
  removeQuestion(
    @Param('id') id: string,
    @Param('questionId') questionId: string,
    @CurrentPlatformAdmin() platformAdmin: PlatformAdminJwtPayload,
    @Req() request: Request,
  ) {
    return this.coursesService.removeQuestion(platformAdmin.sub, id, questionId, request.ip);
  }
}
