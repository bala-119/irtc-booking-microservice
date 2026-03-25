const jwt = require("jsonwebtoken");

const authMiddleware = (requiredRole = null) => {
  return (req, res, next) => {
    try {
      const authHeader = req.headers.authorization;

      //  Token check
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({
          success: false,
          message: "Token missing or invalid"
        });
      }

      const token = authHeader.split(" ")[1];

      //  VERIFY TOKEN HERE (no helper needed)
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      //  Attach user
      req.user = decoded;

      //  ROLE CHECK 
      if (requiredRole && decoded.role !== requiredRole) {
        return res.status(403).json({
          success: false,
          message: `${requiredRole} access only`
        });
      }

      next();

    } catch (error) {
      console.log("AUTH ERROR:", error.message); 

      let message = "Unauthorized";

      if (error.name === "TokenExpiredError") {
        message = "Token expired";
      } else if (error.name === "JsonWebTokenError") {
        message = "Invalid token";
      }

      return res.status(401).json({
        success: false,
        message
      });
    }
  };
};

module.exports = authMiddleware;