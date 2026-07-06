import { CreateNotificationInput, NotificationDTO } from './notification.types';

export interface NotificationRepository {
    findByUser(userId: string): Promise<NotificationDTO[]>;
    findAdminIds(): Promise<string[]>;
    markAsRead(notificationId: string, userId: string): Promise<void>;
    markAllAsRead(userId: string): Promise<void>;
    create(input: CreateNotificationInput): Promise<NotificationDTO>;
}
