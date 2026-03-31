const express = require("express");
const dotenv = require("dotenv");
const connectDB = require("./app/config/dbConnect");   // your DB file
//const notificationRoutes = require("./app/routes/sendemailroutes");
const BookingAndSchema = require("./app/routers/schedule_routes")
dotenv.config();

const app = express();

app.use(express.json());

// connect MongoDB
connectDB();

app.use("/v1/booking", BookingAndSchema);

app.listen(process.env.PORT, () => {
    console.log(`Server running on port  ${process.env.PORT}`);
});