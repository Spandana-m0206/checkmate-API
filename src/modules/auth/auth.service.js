import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import redis from "../../config/redis.js";
import { sendOTPEmail } from "../../config/sendgrid.js";
import { userService } from "../user/index.js";
import ApiError from "../../utils/ApiError.js";
import logger from "../../utils/logger.js";

const OTP_VALIDITY_MS = (parseInt(process.env.OTP_TTL_SECONDS) || 600) * 1000;
const OTP_TTL_SECONDS = parseInt(process.env.OTP_TTL_SECONDS) || 600;
const EMAIL_VERIFIED_TTL = 600; // 10 minutes

const authService = {
  // Generate a random 4-digit OTP
  generateOTP() {
    return Math.floor(1000 + Math.random() * 9000).toString();
  },

  // Generate JWT access token (12h expiry, matching Maguz-API)
  generateAccessToken(user) {
    return jwt.sign(
      { userId: user._id, email: user.email, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: "12h" }
    );
  },

  // Generate JWT refresh token (7d expiry, matching Maguz-API)
  generateRefreshToken(userId) {
    return jwt.sign(
      { userId },
      process.env.REFRESH_SECRET,
      { expiresIn: "7d" }
    );
  },

  // Save refresh token to user document (matching Maguz-API)
  async saveRefreshToken(userId, token) {
    await userService.updateById(userId, { refreshToken: token });
  },

  // Send OTP to email
  async sendOTP(email) {
    const otp = this.generateOTP();
    const hashedOtp = await bcrypt.hash(otp, 10);

    // Store hashed OTP in Redis with explicit expiresAt timestamp + TTL
    const expiresAt = Date.now() + OTP_VALIDITY_MS;
    await redis.set(
      `otp:${email}`,
      JSON.stringify({ otp: hashedOtp, expiresAt }),
      "EX",
      OTP_TTL_SECONDS
    );

    // Send email
    try {
      await sendOTPEmail(email, otp);
    } catch (error) {
      const sgBody = error.response?.body;
      logger.error(
        `SendGrid error: ${error.message}${sgBody ? ` | ${JSON.stringify(sgBody)}` : ""}`
      );
      throw new ApiError(500, "Failed to send OTP email");
    }
  },

  // Verify OTP with timestamp-based validity check (matching Maguz-API approach)
  async verifyOTP(email, otp) {
    const stored = await redis.get(`otp:${email}`);
    if (!stored) {
      throw new ApiError(400, "OTP expired or invalid");
    }

    const { otp: hashedOtp, expiresAt } = JSON.parse(stored);

    // Explicit timestamp check (Maguz-API verification approach)
    if (expiresAt <= Date.now()) {
      await redis.del(`otp:${email}`);
      throw new ApiError(400, "OTP expired or invalid");
    }

    const isMatch = await bcrypt.compare(otp, hashedOtp);
    if (!isMatch) {
      throw new ApiError(400, "Incorrect OTP");
    }

    // Delete OTP after successful verification
    await redis.del(`otp:${email}`);

    // Check if user exists
    const user = await userService.findByEmail(email);

    if (user) {
      // Existing user — issue access + refresh tokens
      const accessToken = this.generateAccessToken(user);
      const refreshToken = this.generateRefreshToken(user._id);
      await this.saveRefreshToken(user._id, refreshToken);
      return { accessToken, refreshToken, user, isNewUser: false };
    }

    // New user — store verified email in Redis for registration
    await redis.set(`email-verified:${email}`, "1", "EX", EMAIL_VERIFIED_TTL);
    return { isNewUser: true };
  },

  // Refresh access token using refresh token (matching Maguz-API)
  async refreshAccessToken(refreshToken) {
    if (!refreshToken) {
      throw new ApiError(401, "Refresh token is required");
    }

    let payload;
    try {
      payload = jwt.verify(refreshToken, process.env.REFRESH_SECRET);
    } catch {
      throw new ApiError(401, "Invalid or expired refresh token");
    }

    const user = await userService.findById(payload.userId);
    if (!user) {
      throw new ApiError(401, "User not found");
    }

    // Check stored refresh token matches (Maguz-API validation)
    if (user.refreshToken !== refreshToken) {
      throw new ApiError(401, "Invalid refresh token");
    }

    // Rotate both tokens
    const newAccessToken = this.generateAccessToken(user);
    const newRefreshToken = this.generateRefreshToken(user._id);
    await this.saveRefreshToken(user._id, newRefreshToken);

    return { accessToken: newAccessToken, refreshToken: newRefreshToken };
  },

  // Blacklist an access token and clear refresh token
  async logout(accessToken, userId) {
    try {
      // Blacklist the access token
      const decoded = jwt.decode(accessToken);
      if (decoded && decoded.exp) {
        const remainingSeconds = decoded.exp - Math.floor(Date.now() / 1000);
        if (remainingSeconds > 0) {
          await redis.set(`blacklist:${accessToken}`, "1", "EX", remainingSeconds);
        }
      }

      // Clear refresh token from user document
      if (userId) {
        await userService.updateById(userId, { refreshToken: null });
      }
    } catch (error) {
      logger.error(`Logout error: ${error.message}`);
      throw new ApiError(500, "Failed to logout");
    }
  },

  // Check if a token has been blacklisted
  async isTokenBlacklisted(token) {
    const result = await redis.get(`blacklist:${token}`);
    return result !== null;
  },

  // Register a new user (email must be OTP-verified via Redis key)
  async register({ email, username, name, dateOfBirth, profileImage }) {
    // Check email was verified via OTP
    const verified = await redis.get(`email-verified:${email}`);
    if (!verified) {
      throw new ApiError(401, "Email not verified. Please verify OTP first.");
    }

    // Check if username is taken
    const existing = await userService.findByUsername(username);
    if (existing) {
      throw new ApiError(409, "Username already taken");
    }

    // Check if email is already registered
    const existingEmail = await userService.findByEmail(email);
    if (existingEmail) {
      throw new ApiError(409, "Email already registered");
    }

    const user = await userService.create({
      email,
      username,
      name,
      dateOfBirth,
      profileImage,
    });

    // Issue tokens
    const accessToken = this.generateAccessToken(user);
    const refreshToken = this.generateRefreshToken(user._id);
    await this.saveRefreshToken(user._id, refreshToken);

    // Clean up verified email key
    await redis.del(`email-verified:${email}`);

    return { accessToken, refreshToken, user };
  },
};

export default authService;
