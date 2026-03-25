const jwtHandler = require("../helpers/verifyToken");

const verifyAdmin = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    //  Check token presence
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Invalid token"
      });
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwtHandler.verifyToken(token);

    //  Attach user
    req.user = decoded;

    //  ADMIN CHECK
    if (!decoded || decoded.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Admin access only"
      });
    }

    next();

  } catch (err) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized"
    });
  }
};

module.exports = verifyAdmin;