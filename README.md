# Growing Chat Backend

Backend completo para el sistema de chat de soporte de Growing Inmobiliario.

## Stack Tecnológico

- **Node.js + Express** - Servidor web
- **PostgreSQL** - Base de datos relacional
- **Sequelize** - ORM
- **JWT** - Autenticación
- **n8n** - Integración con chatbot IA

## Estructura del Proyecto

```
backend/
├── config/
│   ├── database.js       # Configuración de PostgreSQL
│   └── migrate.js        # Script de migración
├── models/
│   ├── User.js          # Modelo de usuario
│   ├── Conversation.js  # Modelo de conversación
│   ├── Message.js       # Modelo de mensaje
│   └── index.js         # Relaciones entre modelos
├── routes/
│   ├── auth.js          # Rutas de autenticación
│   ├── chat.js          # Rutas del chat (conecta con n8n)
│   └── admin.js         # Rutas de administración
├── middleware/
│   └── auth.js          # Middleware JWT
├── server.js            # Archivo principal
├── .env                 # Variables de entorno
├── Dockerfile           # Para Easypanel
└── docker-compose.yml   # Para desarrollo local
```

## Instalación Local

### Opción 1: Con Docker (Recomendado)

```bash
# Clonar o copiar archivos
cd backend/

# Configurar variables de entorno
cp .env.example .env
# Editar .env con tus valores

# Iniciar servicios
docker-compose up -d

# Ver logs
docker-compose logs -f
```

### Opción 2: Sin Docker

```bash
# Instalar dependencias
npm install

# Configurar PostgreSQL local
# Crear base de datos: growing_chat

# Configurar .env
cp .env.example .env
# Editar con tus credenciales de PostgreSQL

# Ejecutar migraciones
npm run migrate

# Iniciar en desarrollo
npm run dev

# O en producción
npm start
```

## Despliegue en Easypanel

### 1. Preparar el Código

```bash
# En tu repositorio Git
git add .
git commit -m "Backend ready for deployment"
git push origin main
```

### 2. Configurar en Easypanel

1. **Crear nueva app** en Easypanel
2. **Tipo**: Docker / Node.js
3. **Source**: Git repository
4. **Branch**: main
5. **Build Path**: /backend
6. **Dockerfile**: Usar el incluido

### 3. Variables de Entorno en Easypanel

Agregar estas variables en la configuración:

```env
NODE_ENV=production
PORT=3001
DB_HOST=tu-postgres-host
DB_PORT=5432
DB_NAME=growing_chat
DB_USER=tu-usuario
DB_PASSWORD=tu-password-seguro
JWT_SECRET=genera-una-clave-super-segura
N8N_WEBHOOK_URL=https://tu-n8n.com/webhook/chat
FRONTEND_URL=https://tu-frontend.com
```

### 4. Base de Datos PostgreSQL

Si no tienes PostgreSQL en Easypanel:

1. **Agregar servicio PostgreSQL** en Easypanel
2. **Copiar credenciales** generadas
3. **Actualizar variables** de entorno con las credenciales

### 5. Conectar con n8n

En tu workflow de n8n:
1. El webhook debe apuntar a: `N8N_WEBHOOK_URL`
2. Configurar la respuesta con formato:
```json
{
  "response": "Respuesta del bot",
  "category": "detectada",
  "confidence": 0.95
}
```

## Migraciones de Base de Datos

```bash
# Primera vez (crear tablas y admin)
npm run migrate

# El script creará:
# - Todas las tablas necesarias
# - Usuario admin por defecto
# - Datos de ejemplo (solo en desarrollo)
```

## Endpoints API

### Autenticación
- `POST /api/auth/register` - Registro de usuario
- `POST /api/auth/login` - Login
- `GET /api/auth/profile` - Ver perfil
- `PUT /api/auth/profile` - Actualizar perfil

### Chat
- `POST /api/chat/message` - Enviar mensaje (conecta con n8n)
- `GET /api/chat/conversations` - Listar conversaciones
- `GET /api/chat/conversation/:id` - Ver conversación
- `PATCH /api/chat/conversation/:id/status` - Cambiar estado
- `POST /api/chat/conversation/:id/rate` - Calificar

### Admin
- `GET /api/admin/users` - Listar usuarios
- `GET /api/admin/analytics` - Dashboard analytics
- `GET /api/admin/conversations` - Todas las conversaciones
- `POST /api/admin/conversations/:id/message` - Responder como admin

## Seguridad Implementada

- ✅ Autenticación JWT
- ✅ Bcrypt para passwords
- ✅ Rate limiting
- ✅ Helmet para headers
- ✅ CORS configurado
- ✅ Validación de inputs
- ✅ SQL injection protection (Sequelize)

## Monitoreo

### Health Check
```bash
curl http://localhost:3001/health
```

### Logs en Easypanel
Ver en la consola de Easypanel o configurar servicio de logs externo.

## Troubleshooting

### Error de conexión a PostgreSQL
- Verificar credenciales en .env
- Verificar que PostgreSQL está corriendo
- Verificar firewall/red en Easypanel

### Error de n8n
- Verificar N8N_WEBHOOK_URL
- Verificar que n8n workflow está activo
- Revisar timeout (30 segundos configurado)

### Error de migraciones
```bash
# Reset completo (CUIDADO: borra todos los datos)
DROP DATABASE growing_chat;
CREATE DATABASE growing_chat;
npm run migrate
```

## Desarrollo

### Estructura de Respuesta API
```json
{
  "success": true/false,
  "message": "Mensaje descriptivo",
  "data": {} // Datos de respuesta
}
```

### Agregar Nuevas Rutas
1. Crear archivo en `/routes`
2. Importar en `server.js`
3. Aplicar middleware necesario

### Testing Local
```bash
# Con curl
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@growing-inmobiliario.com","password":"Admin123!"}'
```

## Próximos Pasos

1. **Conectar Frontend**: Actualizar FRONTEND_URL
2. **SSL/HTTPS**: Configurar en Easypanel
3. **Backup DB**: Configurar backups automáticos
4. **Monitoring**: Agregar Sentry o similar
5. **RAG**: Preparar endpoints para cuando agregues RAG

## Soporte

Para dudas sobre el despliegue en Easypanel:
- Revisar logs en el panel
- Verificar variables de entorno
- Confirmar conexiones de red

---

**Desarrollado para Growing Inmobiliario**  
Backend listo para producción con PostgreSQL y n8n