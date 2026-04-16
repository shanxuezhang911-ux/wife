package com.wife.server.util;

import javax.crypto.Cipher;
import javax.crypto.spec.IvParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Base64;

public class AesUtil {

    private static final String ALGORITHM = "AES/CBC/PKCS5Padding";
    private static final SecureRandom RANDOM = new SecureRandom();

    /**
     * AES-128-CBC 加密
     * @return Base64(IV + ciphertext)
     */
    public static String encrypt(String plaintext, String key) {
        try {
            byte[] keyBytes = key.getBytes(StandardCharsets.UTF_8);
            byte[] iv = new byte[16];
            RANDOM.nextBytes(iv);

            Cipher cipher = Cipher.getInstance(ALGORITHM);
            cipher.init(Cipher.ENCRYPT_MODE,
                    new SecretKeySpec(keyBytes, "AES"),
                    new IvParameterSpec(iv));
            byte[] encrypted = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));

            byte[] result = new byte[iv.length + encrypted.length];
            System.arraycopy(iv, 0, result, 0, iv.length);
            System.arraycopy(encrypted, 0, result, iv.length, encrypted.length);

            return Base64.getEncoder().encodeToString(result);
        } catch (Exception e) {
            throw new RuntimeException("AES encrypt failed", e);
        }
    }

    /**
     * AES-128-CBC 解密
     * @param base64Data Base64(IV + ciphertext)
     */
    public static String decrypt(String base64Data, String key) {
        try {
            byte[] data = Base64.getDecoder().decode(base64Data);
            if (data.length < 16) {
                throw new IllegalArgumentException("Invalid encrypted data");
            }

            byte[] iv = new byte[16];
            System.arraycopy(data, 0, iv, 0, 16);
            byte[] ciphertext = new byte[data.length - 16];
            System.arraycopy(data, 16, ciphertext, 0, ciphertext.length);

            byte[] keyBytes = key.getBytes(StandardCharsets.UTF_8);
            Cipher cipher = Cipher.getInstance(ALGORITHM);
            cipher.init(Cipher.DECRYPT_MODE,
                    new SecretKeySpec(keyBytes, "AES"),
                    new IvParameterSpec(iv));

            return new String(cipher.doFinal(ciphertext), StandardCharsets.UTF_8);
        } catch (Exception e) {
            throw new RuntimeException("AES decrypt failed", e);
        }
    }
}
