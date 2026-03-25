const jwtHandler = require("../helpers/verifyToken");

const authMiddleware = (requiredRole = null) => {
  return (req, res, next) => {
    try {
      const authHeader = req.headers.authorization;

      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({
          success: false,
          message: "Invalid token"
        });
      }

      const token = authHeader.split(" ")[1];
      const decoded = jwtHandler.verifyToken(token);

      // attach user
      req.user = decoded;

      //  ROLE CHECK
      // if (requiredRole && decoded.role !== requiredRole) {
      //   return res.status(403).json({
      //     success: false,
      //     message: `${requiredRole} only`
      //   });
      // }

      next();

    } catch (err) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized"
      });
    }
  };
};

module.exports = authMiddleware;