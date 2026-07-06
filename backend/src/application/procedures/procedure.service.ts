import { ProcedureRepository } from '../../domain/procedures/procedure.repository';
import { supabase } from '../../infrastructure/config/supabase.config';
import { logger } from '../../infrastructure/config/logger.config';
import { isTransitionValid, normalizeStatus, STATUS_LABELS } from '../../domain/procedures/status-machine';
import { StatusHistoryService } from './status-history.service';
import { SocketEvents } from '../../infrastructure/websocket';
import { NotificationService } from '../notifications/notification.service';
import { NotificationType } from '../../domain/notifications/notification.types';

const STATUS_NOTIFICATION_MAP: Record<string, { type: NotificationType; title: string; messageFn: (procedureName: string) => string }> = {
    in_review: {
        type: 'REQUEST_UPDATED',
        title: 'Solicitud en Revisión',
        messageFn: (name) => `Tu solicitud de "${name}" está siendo revisada por un administrador.`,
    },
    approved: {
        type: 'REQUEST_APPROVED',
        title: 'Solicitud Aprobada',
        messageFn: (name) => `Tu solicitud de "${name}" ha sido aprobada.`,
    },
    rejected: {
        type: 'REQUEST_REJECTED',
        title: 'Solicitud Rechazada',
        messageFn: (name) => `Tu solicitud de "${name}" ha sido rechazada.`,
    },
};

export class ProcedureService {
    private readonly statusHistoryService: StatusHistoryService;

    constructor(
        private readonly procedureRepository: ProcedureRepository,
        private readonly socketEvents?: SocketEvents,
        private readonly notificationService?: NotificationService
    ) {
        this.statusHistoryService = new StatusHistoryService();
    }

    async getAllProcedures(studentId?: string) {
        if (!studentId) {
            return this.procedureRepository.findAllActive();
        }

        const studentCareer = await this.procedureRepository.findStudentCareer(studentId);
        return this.procedureRepository.findAllActive(
            studentCareer?.careerId ?? undefined,
            studentCareer?.facultyId ?? undefined
        );
    }

    async getProcedureDetails(id: string) {
        const procedure = await this.procedureRepository.findById(id);
        if (!procedure) {
            logger.warn('Procedure not found', { procedureId: id });
            throw new Error('Procedure not found');
        }
        return procedure;
    }

    async createRequest(
        studentId: string,
        procedureId: string,
        files: Express.Multer.File[],
        extra?: { career?: string; semester?: string; reason?: string }
    ) {
        logger.info('Procedure request creation attempt', { studentId, procedureId, fileCount: files.length });

        if (!studentId) {
            logger.warn('Request creation rejected: missing studentId');
            throw new Error('Authenticated student required');
        }

        if (files.length === 0) {
            logger.warn('Request creation rejected: no documents provided', { studentId, procedureId });
            throw new Error('At least one document must be provided');
        }

        const procedure = await this.procedureRepository.findById(procedureId);

        if (!procedure) {
            logger.warn('Request creation rejected: procedure does not exist', { studentId, procedureId });
            throw new Error('Procedure not found');
        }

        if (!procedure.isActive) {
            logger.warn('Request creation rejected: procedure is inactive', { studentId, procedureId });
            throw new Error('Procedure is not available for new requests');
        }

        const uploadedDocuments: Array<{ fileName: string; fileUrl: string }> = [];

        for (const file of files) {
            const fileExtension = file.originalname.split('.').pop();
            const fileName = `${studentId}_${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExtension}`;

            const { error } = await supabase.storage
                .from('documents')
                .upload(fileName, file.buffer, {
                    contentType: file.mimetype,
                });

            if (error) {
                logger.error('Supabase storage upload failed', { studentId, procedureId, fileName, error: error.message });
                throw new Error('Failed to upload document');
            }

            const { data: publicUrlData } = supabase.storage
                .from('documents')
                .getPublicUrl(fileName);

            uploadedDocuments.push({
                fileName: file.originalname,
                fileUrl: publicUrlData.publicUrl,
            });
        }

        const studentCareer = await this.procedureRepository.findStudentCareer(studentId);

        const request = await this.procedureRepository.createRequest({
            studentId,
            procedureTypeId: procedureId,
            documents: uploadedDocuments,
            career: studentCareer?.careerName ?? undefined,
            semester: extra?.semester,
            reason: extra?.reason,
        });

        await this.procedureRepository.createAuditLog(
            request.id,
            studentId,
            'STATUS_CHANGE',
            null,
            'pending'
        );

        logger.info('Procedure request created successfully', { requestId: request.id, studentId, procedureId });

        if (this.socketEvents) {
            const student = await this.procedureRepository.findStudentCareer(studentId);
            this.socketEvents.notifyNewRequest({
                requestId: request.id,
                studentName: student?.careerName ?? 'Estudiante',
                procedureName: procedure.name,
                career: student?.careerName ?? '',
                status: 'pending',
                createdAt: request.createdAt?.toISOString() ?? new Date().toISOString(),
            });
        }

        if (this.notificationService) {
            const studentName = await this.procedureRepository.findStudentCareer(studentId);
            await this.notificationService.createForAdmins({
                typeName: 'REQUEST_CREATED',
                title: 'Nueva Solicitud',
                message: `El estudiante ${studentName?.careerName ?? 'Desconocido'} creó una solicitud de "${procedure.name}".`,
            });
            await this.notificationService.createNotification({
                userId: studentId,
                typeName: 'REQUEST_CREATED',
                title: 'Solicitud Enviada',
                message: `Tu solicitud de "${procedure.name}" ha sido creada exitosamente.`,
            });
        }

        return request;
    }

    async getStudentRequests(studentId: string) {
        return this.procedureRepository.findRequestsByStudent(studentId);
    }

    async getRequestTracking(requestId: string, studentId: string) {
        const request = await this.procedureRepository.findRequestTracking(requestId, studentId);
        if (!request) {
            logger.warn('Request tracking not found or unauthorized', { requestId, studentId });
            throw new Error('Request not found or unauthorized');
        }
        return request;
    }

    async updateRequestStatus(
        requestId: string,
        newStatus: string,
        userId: string,
        userRole: string,
        comment?: string
    ) {
        const normalizedStatus = normalizeStatus(newStatus);
        logger.info('Status update attempt', { requestId, newStatus: normalizedStatus, userId, userRole });

        if (userRole !== 'admin') {
            logger.warn('Status update rejected: not authorized', { requestId, userId, userRole });
            throw new Error('Only administrators can update request status');
        }

        const request = await this.procedureRepository.findByIdWithoutAuth(requestId);
        if (!request) {
            logger.warn('Status update rejected: request not found', { requestId });
            throw new Error('Request not found');
        }

        const currentStatus = request.status;
        if (!isTransitionValid(currentStatus, normalizedStatus)) {
            logger.warn('Status update rejected: invalid transition', {
                requestId,
                fromStatus: currentStatus,
                toStatus: normalizedStatus,
            });
            throw new Error(`Invalid status transition from ${currentStatus} to ${normalizedStatus}`);
        }

        const updatedRequest = await this.procedureRepository.updateStatus({
            requestId,
            newStatus: normalizedStatus,
            userId,
            comment,
        });

        await this.procedureRepository.createAuditLog(
            requestId,
            userId,
            'STATUS_CHANGE',
            currentStatus,
            normalizedStatus
        );

        this.statusHistoryService.logStatusChange({
            requestId,
            fromStatus: currentStatus,
            toStatus: normalizedStatus,
            userId,
        });

        logger.info('Request status updated successfully', {
            requestId,
            fromStatus: currentStatus,
            toStatus: normalizedStatus,
            userId,
        });

        if (this.socketEvents) {
            this.socketEvents.notifyStatusChange({
                requestId,
                studentId: request.studentId ?? '',
                oldStatus: currentStatus,
                newStatus: normalizedStatus,
                procedureName: request.procedure?.name ?? 'Trámite',
                updatedAt: new Date().toISOString(),
            });
        }

        if (this.notificationService && request.studentId) {
            const notificationConfig = STATUS_NOTIFICATION_MAP[normalizedStatus];
            if (notificationConfig) {
                const procedureName = request.procedure?.name ?? 'Trámite';
                await this.notificationService.createNotification({
                    userId: request.studentId,
                    typeName: notificationConfig.type,
                    title: notificationConfig.title,
                    message: notificationConfig.messageFn(procedureName),
                });
                logger.info('Status change notification created', {
                    requestId,
                    studentId: request.studentId,
                    type: notificationConfig.type,
                });
            }
        }

        return updatedRequest;
    }

    async getRequestTimeline(requestId: string, studentId: string) {
        const request = await this.procedureRepository.findRequestTracking(requestId, studentId);
        if (!request) {
            logger.warn('Request timeline not found or unauthorized', { requestId, studentId });
            throw new Error('Request not found or unauthorized');
        }

        return this.statusHistoryService.buildTimeline(
            {
                createdAt: request.createdAt,
                status: request.status,
                observations: request.observations,
                auditLogs: request.auditLogs,
            },
            STATUS_LABELS
        );
    }

    async adminGetRequestTimeline(requestId: string) {
        const request = await this.procedureRepository.findByIdWithoutAuth(requestId);
        if (!request) {
            logger.warn('Request timeline not found', { requestId });
            throw new Error('Request not found');
        }

        const auditLogs = await this.procedureRepository.findAuditLogsByRequest(requestId);

        return this.statusHistoryService.buildTimeline(
            {
                createdAt: request.createdAt,
                status: request.status,
                observations: request.observations,
                auditLogs,
            },
            STATUS_LABELS
        );
    }
}
