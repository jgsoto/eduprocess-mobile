require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL || '';
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
    const studentId = 'd93f3dac-ea18-405d-baaf-678621560d3f';
    const adminId = '14418832-9242-4052-8b80-32f52b40bd20';

    // Create type catalogs
    const types = ['REQUEST_CREATED', 'REQUEST_APPROVED', 'REQUEST_REJECTED', 'ADMIN_OBSERVATION', 'REQUEST_UPDATED'];
    const catalogs = {};
    for (const name of types) {
        const catalog = await prisma.notificationTypeCatalog.upsert({
            where: { name },
            update: {},
            create: { name },
        });
        catalogs[name] = catalog.id;
    }

    // Student notifications
    const studentNotifs = [
        { userId: studentId, typeId: catalogs['REQUEST_CREATED'], title: 'Solicitud Creada', message: 'Tu solicitud de Certificado de Notas ha sido creada exitosamente.', isRead: false },
        { userId: studentId, typeId: catalogs['REQUEST_APPROVED'], title: 'Solicitud Aprobada', message: 'Tu solicitud de Constancia de Estudios ha sido aprobada por el administrador.', isRead: false },
        { userId: studentId, typeId: catalogs['REQUEST_REJECTED'], title: 'Solicitud Rechazada', message: 'Tu solicitud de Prácticas Preprofesionales fue rechazada. Revisa los comentarios.', isRead: true },
        { userId: studentId, typeId: catalogs['ADMIN_OBSERVATION'], title: 'Nueva Observación', message: 'El administrador Juan agregó un comentario: "Falta documentación adicional"', isRead: false },
        { userId: studentId, typeId: catalogs['REQUEST_UPDATED'], title: 'Solicitud en Revisión', message: 'Tu solicitud de Aprobación de Tema de Grado está siendo revisada.', isRead: false },
    ];

    // Admin notifications
    const adminNotifs = [
        { userId: adminId, typeId: catalogs['REQUEST_CREATED'], title: 'Nueva Solicitud', message: 'El estudiante Carlos Pérez ha creado una nueva solicitud de Certificado de Notas.', isRead: false },
        { userId: adminId, typeId: catalogs['REQUEST_CREATED'], title: 'Nueva Solicitud', message: 'El estudiante María García ha creado una solicitud de Constancia de Estudios.', isRead: true },
        { userId: adminId, typeId: catalogs['REQUEST_CREATED'], title: 'Nueva Solicitud', message: 'El estudiante Luis Torres ha enviado Prácticas Preprofesionales.', isRead: false },
    ];

    console.log('=== Creando notificaciones para ESTUDIANTE ===');
    for (const data of studentNotifs) {
        const created = await prisma.notification.create({ data });
        console.log(`  [${created.isRead ? 'READ' : 'UNREAD'}] ${created.title}`);
    }

    console.log('\n=== Creando notificaciones para ADMIN ===');
    for (const data of adminNotifs) {
        const created = await prisma.notification.create({ data });
        console.log(`  [${created.isRead ? 'READ' : 'UNREAD'}] ${created.title}`);
    }

    console.log('\nDone!');
}

main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(async () => { await prisma.$disconnect(); });
