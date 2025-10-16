export const REST_ENDPOINTS = {
  API_BASE: process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:2567',
  AUTH: {
    USERNAME_VALIDATE: "/auth/username/validate",
    EMAIL_VALIDATE: "/auth/email/validate",
    PASSWORD_VALIDATE: "/auth/password/validate",
    REGISTER: "/auth/register",
    LOGIN: "/auth/login",
    LOGOUT: "/auth/logout",
    SESSION: "/auth/session",
    HANDSHAKE: "/auth/handshake",
  },
  MATCH: {
    QUEUE: "/match/queue",
    CANCEL: "/match/cancel",
    GET_INFO: "/match/info",
    RUN: "/match/run",
  },
  SETTINGS: {
    GET_SETTINGS: "/settings",
    UPDATE_SETTINGS: "/settings",
    UPDATE_PROFILE_PICTURE: "/settings/pfp",
  },
  GLOBAL: {
    GET_STATS: "/global/stats",
    GET_GENERAL_STATS: "/global/general-stats",
    GET_TOP_RANKED_USERS: "/global/top-ranked-users",
  },
};
