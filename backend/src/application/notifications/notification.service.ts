import { NotificationRepository } from '../../domain/notifications/notification.repository';
import { CreateNotificationInput } from '../../domain/notifications/notification.types';
import { logger } from '../../infrastructure/config/logger.config';

export class NotificationService {
    constructor(private readonly notificationRepository: NotificationRepository) {}

    async getNotifications(userId: string) {
        logger.info('Fetching notifications', { userId });
        return this.notificationRepository.findByUser(userId);
    }

    async markAsRead(notificationId: string, userId: string) {
        logger.info('Marking notification as read', { notificationId, userId });
        await this.notificationRepository.markAsRead(notificationId, userId);
    }

    async markAllAsRead(userId: string) {
        logger.info('Marking all notifications as read', { userId });
        await this.notificationRepository.markAllAsRead(userId);
    }

    async createNotification(input: CreateNotificationInput) {
        logger.info('Creating notification', { userId: input.userId, type: input.typeName });
        return this.notificationRepository.create(input);
    }

    async createForAdmins(input: Omit<CreateNotificationInput, 'userId'>) {
        const adminIds = await this.notificationRepository.findAdminIds();
        logger.info('Creating notifications for admins', { adminCount: adminIds.length, type: input.typeName });
        const results = await Promise.all(
            adminIds.map((adminId) =>
                this.notificationRepository.create({ ...input, userId: adminId })
            )
        );
        return results;
    }
}
