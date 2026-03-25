const express = require("express");
const router = express.Router();

const scheduleController = require("../controllers/scheduleController")
const authMiddleware = require("../middlewares/authMiddleware");
const bookingController = require("../controllers/bookingController");
const verifyUserVerified = require("../middlewares/verifyUserVerified.middleware");
const checkProfileCompleted = require("../middlewares/checkProfileCompleted")
const adminAuthMiddleware = require("../middlewares/admin.authMiddleware")
router.post("/schedule/generate",checkProfileCompleted,adminAuthMiddleware("admin"),scheduleController.generateSchedule);



router.get("/download-ticket/:pnr",checkProfileCompleted,authMiddleware(), bookingController.downloadTicket);
router.post("/book",checkProfileCompleted, authMiddleware(),bookingController.bookTicket);
router.get("/:pnr",checkProfileCompleted, authMiddleware(),bookingController.getBooking);
router.delete("/cancel-ticket/:pnr",checkProfileCompleted,authMiddleware(),bookingController.cancelTicket);
router.get("/schedule/search-trains",scheduleController.searchSchedules);


module.exports = router;


