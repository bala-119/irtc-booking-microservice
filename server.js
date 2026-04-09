const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");

// Load environment variables
dotenv.config();

// Import your modules
const connectDB = require("./app/config/dbConnect");
const BookingAndSchema = require("./app/routers/schedule_routes");
const waitingListProcessor = require("./app/jobs/waitingListProcessor");

const app = express();


// ✅ Enable CORS for ALL origins (testing purpose)
app.use(cors({
  origin: 'https://bala-119.github.io',
  credentials: true
}));


// ✅ Middleware
app.use(express.json());


// ✅ Connect to MongoDB
connectDB();


// ✅ Start background job
waitingListProcessor.startProcessor();


// ✅ Routes
app.use("/v1/booking", BookingAndSchema);


// ✅ Test route (check if backend is live)
app.get("/api/test", (req, res) => {
    res.json({
        success: true,
        message: "Backend is working 🚀"
    });
});


// ✅ Handle unknown routes
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: "Route not found"
    });
});


// ✅ PORT (important for Render)
const PORT = process.env.PORT || 5000;


// ✅ Start server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});