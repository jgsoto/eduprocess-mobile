import { Prisma } from '@prisma/client';
import { NotificationRepository } from '../../../../domain/notifications/notification.repository';
import { CreateNotificationInput, NotificationDTO, NotificationType } from '../../../../domain/notifications/notification.types';
import { prisma } from '../../database.config';

const notificationWithtype = Prisma.validator<Prisma.NotificationInclude>()({
    type: true,
});

type NotificationWithtype = Prisma.NotificationGetPayload<{ include: typeof notificationWithtype }>;

export class PrismaNotificationRepository implements NotificationRepository {
    async findAdminIds(): Promise<string[]> {
        const admins = await prisma.user.findMany({
            where: { role: 'admin' },
            select: { id: true },
        });
        return admins.map((a: { id: string }) => a.id);
    }

    async findByUser(userId: string): Promise<NotificationDTO[]> {
        const notifications = await prisma.notification.findMany({
            where: { userId },
            include: notificationWithtype,
            orderBy: { createdAt: 'desc' },
        });

        return notifications.map((n: NotificationWithtype) => ({
            id: n.id,
            title: n.title,
            message: n.message,
            type: (n.type?.name as NotificationType) ?? null,
            isRead: n.isRead,
            createdAt: n.createdAt,
            userId: n.userId,
        }));
    }

    async markAsRead(notificationId: string, userId: string): Promise<void> {
        await prisma.notification.updateMany({
            where: { id: notificationId, userId },
            data: { isRead: true },
        });
    }

    async markAllAsRead(userId: string): Promise<void> {
        await prisma.notification.updateMany({
            where: { userId, isRead: false },
            data: { isRead: true },
        });
    }

    async create(input: CreateNotificationInput): Promise<NotificationDTO> {
        let typeId: string | undefined;

        if (input.typeName) {
            const catalog = await prisma.notificationTypeCatalog.upsert({
                where: { name: input.typeName },
                update: {},
                create: { name: input.typeName },
            });
            typeId = catalog.id;
        }

        const notification = await prisma.notification.create({
            data: {
                userId: input.userId,
                title: input.title,
                message: input.message,
                typeId: typeId ?? null,
            },
            include: notificationWithtype,
        });

        return {
            id: notification.id,
            title: notification.title,
            message: notification.message,
            type: (notification.type?.name as NotificationType) ?? null,
            isRead: notification.isRead,
            createdAt: notification.createdAt,
            userId: notification.userId,
        };
    }
}
