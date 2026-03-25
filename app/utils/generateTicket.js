const fs = require("fs");
const path = require("path");
const Handlebars = require("handlebars");
const puppeteer = require("puppeteer");

async function generateTicketPDF(booking) {
  try {
    console.log("📦 BOOKING DATA:", booking);

    // 📄 Load HBS template
    const filePath = path.join(__dirname, "../templates/ticket.hbs");
    const source = fs.readFileSync(filePath, "utf8");

    // 🔧 Compile template
    const template = Handlebars.compile(source);

    // ✅ Normalize data (important)
    const data = {
      pnr: booking.pnr,
      train_number: booking.train_number,
      train_name: booking.train_name,
      from_station: booking.from_station,
      to_station: booking.to_station,
      journey_date: new Date(booking.journey_date).toDateString(),
      class_type: booking.class_type,
      fare_per_passenger: booking.fare_per_passenger,
      total_fare: booking.total_fare,
      booking_type: booking.booking_type,
      status : booking.status,


      // ✅ Passengers fix
      passengers: (booking.passengers || []).map(p => ({
        name: p.name || "-",
        age: p.age || "-",
        gender: p.gender || "-"   // avoid empty column
      })),

      // ✅ Seat fix (MAIN ISSUE FIXED HERE)
      seat_details: (booking.seat_details || []).map(s => ({
        coach: s.coach || "-",
        seat_number: s.seat_number || "-"   // 👈 IMPORTANT
      }))
    };

    console.log("✅ FINAL TEMPLATE DATA:", data);

    // 🔄 Generate HTML
    const html = template(data);

    // 🧪 Debug HTML (optional)
    fs.writeFileSync("debug.html", html);

    // 🚀 Launch Puppeteer
    const browser = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "domcontentloaded" });

    // 📁 Ensure tickets folder exists
    const dir = path.join(__dirname, "../tickets");
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir);
    }

    const pdfPath = path.join(dir, `${booking.pnr}.pdf`);

    // 📄 Generate PDF
    await page.pdf({
      path: pdfPath,
      format: "A4",
      printBackground: true
    });

    await browser.close();

    console.log("🎉 PDF GENERATED:", pdfPath);

    return pdfPath;

  } catch (err) {
    console.error("❌ ERROR:", err);
    throw err;
  }
}

module.exports = generateTicketPDF;