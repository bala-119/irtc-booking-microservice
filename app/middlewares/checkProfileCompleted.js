const jwt = require("jsonwebtoken");

const checkProfileCompleted = async (req, res, next) => {
  try {
    // 1. Get token
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Token missing or invalid"
      });
    }

    const token = authHeader.split(" ")[1];

    //  2. Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    //  3. Extract user from token
    const user = decoded;   //  THIS is the key change

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "User not found in token"
      });
    }

    // attach user
    req.user = user;

    // 4. Verification checks
    if (!user.email_verified) {
      return res.status(403).json({
        success: false,
        message: "Email not verified"
      });
    }

    if (!user.phone_verified) {
      return res.status(403).json({
        success: false,
        message: "Phone not verified"
      });
    }

    if (!user.aadhaarId_verified) {
      return res.status(403).json({
        success: false,
        message: "Aadhaar not verified"
      });
    }

    //  5. Required fields check
    const requiredFields = [
      "fullName",
      "user_name",
      "email",
      "phone",
      "mpin",
      "role"
    ];

    const missingFields = [];

    requiredFields.forEach(field => {
      const value = user[field];

      if (
        value === undefined ||
        value === null ||
        (typeof value === "string" && value.trim() === "")
      ) {
        missingFields.push(field);
      }
    });

    if (missingFields.length > 0) {
      return res.status(403).json({
        success: false,
        message: `Complete your profile. Missing: ${missingFields.join(", ")}`
      });
    }

    
    next();

  } catch (error) {
    return res.status(401).json({
      success: false,
      message: error.message || "Invalid token"
    });
  }
};

module.exports = checkProfileCompleted;