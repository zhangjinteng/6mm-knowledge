import { TOTP, Secret } from 'otpauth';

/**
 * 验证用户提交的 TOTP 验证码。
 * window=1 允许前后各 1 个时间窗口偏移（±30s），容忍客户端时钟微小差异。
 */
export const verifyTOTP = (secret: string, token: string): boolean => {
  const totp = new TOTP({
    secret: Secret.fromBase32(secret)
  });
  const delta = totp.validate({ token, window: 1 });
  return delta !== null;
};

/**
 * 生成新的 2FA secret 和 otpauth URI（用于绑定流程生成二维码）。
 * @param username 用户名，显示在 Authenticator App 中
 */
export const generateTOTPSecret = (username: string) => {
  const secret = new Secret();
  const totp = new TOTP({
    issuer: 'WorkGPT',
    label: username,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret
  });
  return {
    secret: secret.base32,
    uri: totp.toString()
  };
};
