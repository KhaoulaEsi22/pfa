import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const email = 'admin@iits.ma';
  const passwordHash = await bcrypt.hash('admin123', 10);

  await prisma.user.upsert({
    where: { email },
    update: { passwordHash },            // <-- met à jour le mot de passe si l'user existe
    create: { email, passwordHash }
  });

  console.log('Seed OK: admin@iits.ma / admin123 (réinitialisé)');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());

