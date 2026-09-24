import authService from "./auth.service.js";
import ApiResponse from "../../utils/ApiResponse.js";
import ApiError from "../../utils/ApiError.js";

const REFRESH_COOKIE_NAME = "refreshToken";
const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
  path: "/api/v1/auth",
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
};

const authController = {
  // POST /auth/send-otp
  async sendOTP(req, res, next) {
    try {
      const { email } = req.body;

      if (!email) {
        throw new ApiError(400, "Email is required");
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        throw new ApiError(400, "Invalid email format");
      }

      await authService.sendOTP(email.toLowerCase().trim());

      const response = new ApiResponse(200, null, "OTP sent to your email");
      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  },

  // POST /auth/verify-otp
  async verifyOTP(req, res, next) {
    try {
      const { email, otp } = req.body;

      if (!email || !otp) {
        throw new ApiError(400, "Email and OTP are required");
      }

      const result = await authService.verifyOTP(
        email.toLowerCase().trim(),
        otp.toString()
      );

      // For existing users, set refresh token as HttpOnly cookie
      if (!result.isNewUser) {
        res.cookie(REFRESH_COOKIE_NAME, result.refreshToken, REFRESH_COOKIE_OPTIONS);
        // Only send accessToken in body — refreshToken stays in cookie
        const { refreshToken, ...body } = result;
        return res.status(200).json(new ApiResponse(200, body, "OTP verified"));
      }

      // New user — no tokens yet
      res.status(200).json(new ApiResponse(200, result, "OTP verified"));
    } catch (error) {
      next(error);
    }
  },

  // POST /auth/register
  async register(req, res, next) {
    try {
      const { email, username, name, dateOfBirth } = req.body;

      if (!email) {
        throw new ApiError(400, "Email is required");
      }
      if (!username || !name || !dateOfBirth) {
        throw new ApiError(400, "Username, name, and date of birth are required");
      }

      const profileImage = req.file
        ? `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`
        : null;

      const result = await authService.register({
        email: email.toLowerCase().trim(),
        username,
        name,
        dateOfBirth,
        profileImage,
      });

      // Set refresh token as HttpOnly cookie
      res.cookie(REFRESH_COOKIE_NAME, result.refreshToken, REFRESH_COOKIE_OPTIONS);
      const { refreshToken, ...body } = result;

      res.status(201).json(new ApiResponse(201, body, "Registration successful"));
    } catch (error) {
      next(error);
    }
  },

  // POST /auth/refresh-token
  async refreshAccessToken(req, res, next) {
    try {
      // Read refresh token from HttpOnly cookie
      const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME];

      const result = await authService.refreshAccessToken(refreshToken);

      // Set new refresh token cookie
      res.cookie(REFRESH_COOKIE_NAME, result.refreshToken, REFRESH_COOKIE_OPTIONS);
      const { refreshToken: _, ...body } = result;

      res.status(200).json(new ApiResponse(200, body, "Token refreshed"));
    } catch (error) {
      next(error);
    }
  },

  // POST /auth/logout
  async logout(req, res, next) {
    try {
      const token = req.headers.authorization.split(" ")[1];
      await authService.logout(token, req.user.userId);

      // Clear refresh token cookie
      res.clearCookie(REFRESH_COOKIE_NAME, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
        path: "/api/v1/auth",
      });

      res.status(200).json(new ApiResponse(200, null, "Logged out successfully"));
    } catch (error) {
      next(error);
    }
  },
};

export default authController;
