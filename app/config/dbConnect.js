const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    await mongoose.connect(`${process.env.DB_URI}`);
    console.log(` MongoDB connected to ${process.env.DB_URI}`);
  } catch (error) {
    console.error(` Error connecting to DB: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;
