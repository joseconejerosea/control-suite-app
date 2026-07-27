¡Buenas! Hice pruebas en solitario con el bot de WhatsApp y hay buenas noticias: la boleta llegó y se procesó bien. Encontré dos puntos para ajustar antes de la prueba con el equipo completo (mi familia):

1) Respuestas del bot: hoy se sienten genéricas, como plantilla fija. Necesitamos que la respuesta refleje lo que efectivamente se recibió y procesó (tipo de documento, monto detectado, a qué proyecto quedó asociado, estado). El usuario de terreno tiene que sentir que el sistema entendió su envío, no que le contestó un autorespondedor.

2) Foto de material POP (F3): envié una foto de una silla y el bot la trató como documento. Ese es el flujo equivocado. Una foto de material debe entrar por el flujo de inventario:
- Identificar que es material POP, no un documento
- Crear ID único para el ítem
- Preguntar a qué proyecto se asocia (y por esa vía queda asociado al cliente como material del cliente)
- Preguntar en qué bodega queda
- Registrar todo como movimiento de inventario

Como siempre, el evento crudo persiste primero en eventos_crudos y la clasificación viene después — si hay ambigüedad entre documento y material, el bot pregunta, nunca asume.

¡Gracias! Vamos muy bien.