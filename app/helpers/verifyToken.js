const jwt = require("jsonwebtoken");

class JwtHandler {

  // 🔥 VERIFY TOKEN
  verifyToken(token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      return decoded;

    } catch (error) {

      if (error.name === "TokenExpiredError") {
        throw new Error("TokenExpiredError");
      }

      if (error.name === "JsonWebTokenError") {
        throw new Error("InvalidTokenError");
      }

      throw new Error("TokenVerificationFailed");
    }
  }

  // 🔥 GENERATE TOKEN (use in login)
  generateToken(payload) {
    try {
      return jwt.sign(payload, process.env.JWT_SECRET, {
        expiresIn: "1d" // 1 day
      });
    } catch (error) {
      throw new Error("TokenGenerationFailed");
    }
  }
}

module.exports = new JwtHandler();