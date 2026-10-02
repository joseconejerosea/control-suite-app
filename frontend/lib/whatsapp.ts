// C2 · Número global de WhatsApp de Control Suite — el que promotores/anfitrionas
// marcan para escribirle al bot. Fuente ÚNICA de verdad para toda la UI (onboarding
// admin + panel del cliente). Overridable por env sin recompilar la constante en cada
// lugar; el default es el número operativo actual. Mismo patrón que NEXT_PUBLIC_API_URL.
export const WHATSAPP_NUMBER =
  process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? "+56 9 8554 4701";

// Link wa.me tocable: solo dígitos (sin "+", espacios ni símbolos).
export const WHATSAPP_WA_ME = `https://wa.me/${WHATSAPP_NUMBER.replace(/\D/g, "")}`;
