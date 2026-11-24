export const hasHardwareAsync = jest.fn(async () => true);
export const isEnrolledAsync = jest.fn(async () => true);
export const supportedAuthenticationTypesAsync = jest.fn(async () => [1]);
export const authenticateAsync = jest.fn(async () => ({ success: true }));
export const AuthenticationType = {
  FINGERPRINT: 1,
  FACIAL_RECOGNITION: 2,
  IRIS: 3,
};
export default {
  hasHardwareAsync,
  isEnrolledAsync,
  supportedAuthenticationTypesAsync,
  authenticateAsync,
  AuthenticationType,
};
