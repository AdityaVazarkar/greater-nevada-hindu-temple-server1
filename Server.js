const express = require("express");
const Stripe = require("stripe");
const cors = require("cors");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const dotenv = require("dotenv");
const nodemailer = require("nodemailer");
const multer = require("multer");
const XLSX = require("xlsx");
const path = require("path");
const fs = require("fs");
dotenv.config(); // Load environment variables from .env
const xlsx = require("xlsx");
const { GridFsStorage } = require("multer-gridfs-storage");
const Grid = require("gridfs-stream");

const app = express();

const JWT_SECRET = process.env.JWT_SECRET;
const MONGO_URI = process.env.MONGO_URI;
const PORT = process.env.PORT || 5000;

const stripe = new Stripe(
  "sk_test_51QNqbPBgGegBsBEaLGeAB50S95sjp7F8XfvTV6WVEaBzsIqd2tfAFUoFQL50ah4NjGOyNmy7JA1Gyyja9OMGd6cf00OJacfIPF"
);

app.use(cors());
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use("/uploads", express.static("uploads"));

// Keep only this one:
mongoose
  .connect(MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB connection error:", err));

mongoose
  .connect(MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 5000, // Timeout after 5s instead of 10s
    socketTimeoutMS: 45000, // Close sockets after 45s of inactivity
  })
  .then(() => {
    console.log("MongoDB connected");
  })
  .catch((err) => console.error("MongoDB connection error:", err));

// MongoDB Schemas and Models
const EventSchema = new mongoose.Schema({
  title: String,
  description: String,
  date: Date,
  time: String, // Add time field
  createdBy: String,
  venue: String,
});

const UserSchema = new mongoose.Schema({
  username: String,
  password: String,
  role: { type: String, enum: ["owner", "admin", "user"], default: "user" },
});

const VolunteerSchema = new mongoose.Schema({
  name: String,
  email: String,
  phone: String,
  address: String,
  interest: String,
  message: String,
});

const ContactUsSchema = new mongoose.Schema({
  name: String,
  email: String,
  message: String,
});

const pledgeSchema = new mongoose.Schema({
  salutation: String,
  firstName: String,
  lastName: String,
  email: String,
  phone: String,
  address1: String,
  address2: String,
  city: String,
  state: String,
  zip: String,
  country: String,
  pledgeType: String,
  fulfillDate: String,
  amount: Number,
  anonymity: String,
  pledgeDate: String,
  signature: String,
});
const bookingSchema = new mongoose.Schema(
  {
    serviceName: String,

    clientName: String,
    phone: String,
    email: String,
    time: String,
  },
  { timestamps: true }
);
const scheduleSchema = new mongoose.Schema({
  day: String,
  time: String,
  event: String,
});
const DevoteeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    description: { type: String, required: true },
    image: { type: String }, // file path
  },
  { timestamps: true }
);

const Event = mongoose.model("Event", EventSchema);
const User = mongoose.model("User", UserSchema);
const Volunteer = mongoose.model("Volunteer", VolunteerSchema);
const ContactUs = mongoose.model("ContactUs", ContactUsSchema);
const Pledge = mongoose.model("Pledge", pledgeSchema);
const Booking = mongoose.model("Booking", bookingSchema);
const Schedule = mongoose.model("Schedule", scheduleSchema);
const Devotee = mongoose.model("Devotee", DevoteeSchema);

const generateToken = (userId) => {
  return jwt.sign({ id: userId }, JWT_SECRET, { expiresIn: "1h" });
};

// 🛡️ Middleware: JWT Authentication
const authenticateJWT = async (req, res, next) => {
  const token = req.headers.authorization;
  if (!token) return res.sendStatus(401);

  try {
    const tokenWithoutBearer = token.split(" ")[1]; // Remove "Bearer" prefix
    const decoded = jwt.verify(tokenWithoutBearer, JWT_SECRET);

    // Fetch full user details from DB
    const user = await User.findById(decoded.id);
    if (!user) return res.sendStatus(403);

    req.user = user; // Attach full user object to request
    next();
  } catch (error) {
    return res.sendStatus(403);
  }
};

// 🛡️ Middleware: Check if User is Owner
const isOwner = (req, res, next) => {
  if (req.user.role !== "owner") {
    return res
      .status(403)
      .json({ error: "Only the owner can perform this action." });
  }
  next();
};

const isOwnerOrAdmin = (req, res, next) => {
  if (req.user.role !== "owner" && req.user.role !== "admin") {
    return res
      .status(403)
      .json({ error: "Only owners and admins can perform this action." });
  }
  next();
};

mongoose
  .connect(MONGO_URI)
  .then(async () => {
    console.log("MongoDB connected");

    // ✅ Only run after DB connection is successful
    const owner = await User.findOne({ username: "owner" });
    if (!owner) {
      const hashedPassword = await bcrypt.hash("owner@123", 10);
      const newOwner = new User({
        username: "owner",
        password: hashedPassword,
        role: "owner",
      });
      await newOwner.save();
      console.log("Owner account created.");
    }
  })
  .catch((err) => console.error("MongoDB connection error:", err));

app.post("/create-user", authenticateJWT, isOwner, async (req, res) => {
  const { newUsername, password, role } = req.body;
  if (!["admin", "user"].includes(role)) {
    return res
      .status(400)
      .json({ message: "Invalid role! Allowed roles: admin, user" });
  }
  if (await User.findOne({ username: newUsername })) {
    return res.status(400).json({ message: "User already exists." });
  }
  const hashedPassword = await bcrypt.hash(password, 10);
  await new User({
    username: newUsername,
    password: hashedPassword,
    role,
  }).save();
  res
    .status(201)
    .json({ message: `User '${newUsername}' created successfully.` });
});

// Get all users
app.get("/users", authenticateJWT, isOwner, async (req, res) => {
  try {
    const users = await User.find({}, "-password"); // Exclude password field
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: "Error fetching users" });
  }
});

// Delete a user by ID
app.delete("/users/:id", authenticateJWT, isOwner, async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json({ message: "User deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Error deleting user" });
  }
});

// Login route (for owner login)
app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ username });

  if (!user) {
    return res.status(400).json({ message: "User not found" });
  }

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) {
    return res.status(400).json({ message: "Invalid credentials" });
  }

  console.log("Role from DB:", user.role); // Debugging

  // ✅ Generate JWT token
  const token = generateToken(user._id);

  res.json({ token, role: user.role });
});

// Get Events route (Public access)
app.get("/events", async (req, res) => {
  try {
    const events = await Event.find({});
    res.send(events);
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

// Create Event route (Only for owner)
app.post("/create-event", authenticateJWT, isOwnerOrAdmin, async (req, res) => {
  const { title, description, date, time, venue } = req.body;
  const createdBy = req.user.username;

  // Create new event with the provided time
  const newEvent = new Event({
    title,
    description,
    date,
    time,
    createdBy,
    venue,
  });

  try {
    await newEvent.save();
    res.status(201).send({ message: "Event created successfully" });
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

app.put(
  "/update-event/:id",
  authenticateJWT,
  isOwnerOrAdmin,
  async (req, res) => {
    try {
      const event = await Event.findByIdAndUpdate(req.params.id, req.body, {
        new: true,
      });
      if (!event) {
        return res.status(404).send({ error: "Event not found" });
      }
      res.send({ message: "Event updated successfully" });
    } catch (error) {
      res.status(500).send({ error: error.message });
    }
  }
);

// Delete Event route (Only for owner)
app.delete(
  "/delete-event/:id",
  authenticateJWT,
  isOwnerOrAdmin,
  async (req, res) => {
    try {
      const event = await Event.findByIdAndDelete(req.params.id);
      if (!event) {
        return res.status(404).send({ error: "Event not found" });
      }
      res.send({ message: "Event deleted successfully" });
    } catch (error) {
      res.status(500).send({ error: error.message });
    }
  }
);

// Create Payment Intent route (for Stripe integration)
app.post("/create-payment-intent", async (req, res) => {
  const { amount } = req.body;

  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency: "usd",
    });

    res.send({
      clientSecret: paymentIntent.client_secret,
    });
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

// Save Volunteer Data (Post route)
app.post("/save-volunteer", async (req, res) => {
  const { name, email, phone, address, interest, message } = req.body;

  if (!name || !email || !phone || !address || !interest || !message) {
    return res.status(400).json({ error: "All fields are required" });
  }

  const existingVolunteer = await Volunteer.findOne({ email });
  if (existingVolunteer) {
    return res
      .status(400)
      .json({ error: "Volunteer with this email already exists" });
  }

  try {
    const newVolunteer = new Volunteer({
      name,
      email,
      phone,
      address,
      interest,
      message,
    });
    await newVolunteer.save();
    res.status(200).json({ message: "Volunteer data saved successfully" });
  } catch (error) {
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Save Contact Us Data (Post route)
app.post("/contact-us", async (req, res) => {
  const { name, email, message } = req.body;

  if (!name || !email || !message) {
    return res.status(400).json({ error: "All fields are required" });
  }

  try {
    const newContactUs = new ContactUs({
      name,
      email,
      message,
    });
    await newContactUs.save();
    res
      .status(200)
      .json({ message: "Your message has been submitted successfully!" });
  } catch (error) {
    res.status(500).json({ error: "Internal Server Error" });
  }
});

//Director

const DirectorSchema = new mongoose.Schema({
  name: { type: String, required: true },
  position: {
    type: String,
    required: true,
    enum: ["Esteemed Donors", "Board Of Trustees", "Board of Directors"],
  },
  phone: { type: String }, // Optional field
});

const Director = mongoose.model("Director", DirectorSchema);

// Add Director (Only for owner)
app.post("/add-director", authenticateJWT, isOwnerOrAdmin, async (req, res) => {
  const { name, position, phone } = req.body; // Add phone to destructuring

  if (!name || !position) {
    return res.status(400).json({ error: "Name and position are required" });
  }

  try {
    const newDirector = new Director({ name, position, phone });
    await newDirector.save();
    res.status(201).json({ message: "Director added successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// // Get Directors (Public access)
app.get("/directors", async (req, res) => {
  try {
    const directors = await Director.find({});
    res.json(directors);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// // Delete Director (Only for owner)
app.delete(
  "/delete-director/:id",
  authenticateJWT,
  isOwnerOrAdmin,
  async (req, res) => {
    try {
      const director = await Director.findByIdAndDelete(req.params.id);
      if (!director) {
        return res.status(404).json({ error: "Director not found" });
      }
      res.json({ message: "Director deleted successfully" });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

//Pledge

app.post("/pledge", async (req, res) => {
  try {
    const newPledge = new Pledge(req.body);
    await newPledge.save();
    res.status(201).json({ message: "Pledge submitted successfully!" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all pledges
app.get("/pledges", async (req, res) => {
  try {
    const pledges = await Pledge.find();
    res.status(200).json(pledges);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
//delete plages
app.delete("/pledges/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await Pledge.findByIdAndDelete(id);
    res.status(200).json({ message: "Pledge deleted successfully!" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

//Subscribe

const EmailSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true }, // Ensure uniqueness
});

const Email = mongoose.model("Email", EmailSchema);

app.post("/subscribe", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email is required" });

    const existingEmail = await Email.findOne({ email });
    if (existingEmail) {
      return res.status(400).json({ message: "Email is already subscribed!" }); // Send the same message
    }

    const newEmail = new Email({ email });
    await newEmail.save();

    res.status(201).json({ message: "Subscription successful!" });
  } catch (error) {
    console.error("Subscription error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

app.get("/subscribers", async (req, res) => {
  try {
    const subscribers = await Email.find();
    res.status(200).json(subscribers);
  } catch (error) {
    console.error("Error fetching subscribers:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

app.delete("/unsubscribe/:email", async (req, res) => {
  try {
    const { email } = req.params;
    const deletedEmail = await Email.findOneAndDelete({ email });

    if (!deletedEmail) {
      return res.status(404).json({ message: "Email not found" });
    }

    res.status(200).json({ message: "Unsubscribed successfully!" });
  } catch (error) {
    console.error("Error unsubscribing email:", error);
    res.status(500).json({ message: "Server error" });
  }
});

//Booking Services
app.post("/book-service", async (req, res) => {
  try {
    const {
      serviceName,

      clientName,
      phone,
      email,
      time,
    } = req.body;

    const newBooking = new Booking({
      serviceName,
      clientName,
      phone,
      email,
      time,
    });

    await newBooking.save();
    res.status(201).json({ message: "Booking saved successfully!" });
  } catch (error) {
    res.status(500).json({ error: "Failed to save booking" });
  }
});
app.get("/bookings", async (req, res) => {
  try {
    const bookings = await Booking.find();
    res.status(200).json(bookings); // Send back the data in JSON format
  } catch (error) {
    console.error("Error fetching bookings:", error);
    res.status(500).json({ error: "Failed to fetch bookings" });
  }
});
// Endpoint to edit a booking
app.put("/bookings/:id", async (req, res) => {
  try {
    const updatedBooking = await Booking.findByIdAndUpdate(
      req.params.id,
      req.body,
      {
        new: true,
      }
    );
    res.json(updatedBooking);
  } catch (error) {
    res.status(500).json({ message: "Error updating booking" });
  }
});

// Endpoint to delete a booking
app.delete("/bookings/:id", async (req, res) => {
  try {
    await Booking.findByIdAndDelete(req.params.id);
    res.json({ message: "Booking deleted" });
  } catch (error) {
    res.status(500).json({ message: "Error deleting booking" });
  }
});

app.post("/send-email", async (req, res) => {
  const { email, subject, message } = req.body;

  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: {
      user: "adityavazarkar34@gmail.com",
      pass: "odiw oywl eiyu pspz", // App password
    },
  });

  const mailOptions = {
    from: "adityavazarkar34@gmail.com",
    to: email,
    subject: subject,
    text: message,
  };

  try {
    await transporter.sendMail(mailOptions);
    res.json({ message: "Email sent successfully!" });
  } catch (error) {
    console.error("Error sending email:", error);
    res
      .status(500)
      .json({ message: "Error sending email", error: error.message });
  }
});

// Add this to your server code
app.post("/send-otp", async (req, res) => {
  const { email, subject, message } = req.body;

  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: {
      user: "adityavazarkar34@gmail.com",
      pass: "odiw oywl eiyu pspz", // App password
    },
  });

  const mailOptions = {
    from: "adityavazarkar34@gmail.com",
    to: email,
    subject: subject,
    text: message,
  };

  try {
    await transporter.sendMail(mailOptions);
    res.json({ message: "OTP sent successfully!" });
  } catch (error) {
    console.error("Error sending OTP:", error);
    res
      .status(500)
      .json({ message: "Error sending OTP", error: error.message });
  }
});
// const upload = multer({ storage: multer.memoryStorage() });

// Upload route
// app.post("/upload", upload.single("file"), async (req, res) => {
//   if (!req.file) return res.status(400).send("No file uploaded");

//   const ext = req.file.originalname.split(".").pop().toLowerCase();

//   let data;
//   try {
//     if (ext === "xlsx" || ext === "xls") {
//       const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
//       const sheetName = workbook.SheetNames[0];
//       const sheet = workbook.Sheets[sheetName];
//       data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
//     } else if (ext === "csv") {
//       const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
//       const sheet = workbook.Sheets[workbook.SheetNames[0]];
//       data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
//     } else if (ext === "json") {
//       data = JSON.parse(req.file.buffer.toString());
//       if (!Array.isArray(data)) throw new Error("Invalid JSON format");
//     } else {
//       return res.status(400).send("Unsupported file format");
//     }
//   } catch (error) {
//     console.error("Parsing error:", error);
//     return res.status(400).send("Failed to parse uploaded file");
//   }

//   // Normalize and format data
//   const formattedData = [];

//   try {
//     if (Array.isArray(data[0])) {
//       // Excel or CSV style with headers in row[0]
//       const headers = data[0];
//       const timeColumnIndex = 0;
//       const dayColumns = headers.slice(1);

//       for (let i = 1; i < data.length; i++) {
//         const row = data[i];
//         const time = row[timeColumnIndex];
//         if (!time) continue;

//         dayColumns.forEach((day, dayIndex) => {
//           const event = row[dayIndex + 1];
//           if (event && day) {
//             formattedData.push({
//               day: day.toString().trim(),
//               time: time.toString().trim(),
//               event: event.toString().trim(),
//             });
//           }
//         });
//       }
//     } else if (Array.isArray(data)) {
//       // JSON style: [{ day: 'Monday', time: '9:00 AM', event: 'Yoga' }]
//       data.forEach((item) => {
//         if (item.day && item.time && item.event) {
//           formattedData.push({
//             day: item.day.toString().trim(),
//             time: item.time.toString().trim(),
//             event: item.event.toString().trim(),
//           });
//         }
//       });
//     }
//   } catch (processError) {
//     console.error("Data processing error:", processError);
//     return res.status(400).send("Error processing file data");
//   }

//   if (formattedData.length === 0) {
//     return res.status(400).send("No valid events found");
//   }

//   // Save to DB
//   try {
//     await Schedule.deleteMany();
//     await Schedule.insertMany(formattedData);
//     return res.send(`Successfully uploaded ${formattedData.length} events`);
//   } catch (dbError) {
//     console.error("DB error:", dbError);
//     return res.status(500).send("Error saving to database");
//   }
// });
// // Get schedule for a specific day
// app.get("/schedule/:day", async (req, res) => {
//   const { day } = req.params;
//   try {
//     const events = await Schedule.find({ day }).sort({ time: 1 });
//     res.json(events);
//   } catch (error) {
//     console.error("Error fetching schedule:", error);
//     res.status(500).send("Error fetching schedule");
//   }
// });

// // Delete an event
// app.delete("/event", async (req, res) => {
//   const { day, time } = req.body;

//   try {
//     const deleted = await Schedule.deleteOne({ day, time });

//     if (deleted.deletedCount === 0) {
//       return res.status(404).send("Event not found");
//     }

//     res.status(200).send("Event deleted successfully");
//   } catch (error) {
//     console.error("Error deleting event:", error);
//     res.status(500).send("Error deleting event");
//   }
// });

let scheduleDatabase = {
  Monday: [],
  Tuesday: [],
  Wednesday: [],
  Thursday: [],
  Friday: [],
  Saturday: [],
  Sunday: [],
};

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});

const upload = multer({ storage });

// Ensure uploads directory exists
if (!fs.existsSync("uploads")) {
  fs.mkdirSync("uploads");
}

// Helper function to convert Excel time to 12-hour format
const formatTime = (excelTime) => {
  if (!excelTime) return "";

  // Excel times are fractions of a day (1 = 24 hours)
  const totalSeconds = excelTime * 24 * 60 * 60;
  const hours = Math.floor(totalSeconds / 3600) % 24;
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  const period = hours >= 12 ? "pm" : "am";
  const displayHours = hours % 12 || 12; // Convert 0 to 12

  return `${displayHours}:${minutes.toString().padStart(2, "0")}${period}`;
};

// API Endpoints

// Upload Excel file
app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).send("No file uploaded");
    }

    const filePath = path.join(__dirname, req.file.path);
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(worksheet);

    // Reset the database
    scheduleDatabase = {
      Monday: [],
      Tuesday: [],
      Wednesday: [],
      Thursday: [],
      Friday: [],
      Saturday: [],
      Sunday: [],
    };

    // Process each row of the Excel file
    data.forEach((row) => {
      const days = [
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
        "Sunday",
      ];

      days.forEach((day) => {
        const time = row["Time"] ? formatTime(row["Time"]) : "";
        const event = row[day] || "";

        if (event && event.trim() !== "") {
          scheduleDatabase[day].push({
            time: time,
            event: event.trim(),
          });
        }
      });
    });

    // Sort events by time for each day
    Object.keys(scheduleDatabase).forEach((day) => {
      scheduleDatabase[day].sort((a, b) => {
        const timeA = a.time.toLowerCase();
        const timeB = b.time.toLowerCase();

        // Simple string comparison for sorting (you might want to improve this)
        if (timeA.includes("am") && timeB.includes("pm")) return -1;
        if (timeA.includes("pm") && timeB.includes("am")) return 1;

        return timeA.localeCompare(timeB);
      });
    });

    // Delete the uploaded file after processing
    fs.unlinkSync(filePath);

    res.status(200).send("Schedule updated successfully");
  } catch (error) {
    console.error("Error processing file:", error);
    res.status(500).send("Error processing file");
  }
});

// Get all events
app.get("/events", (req, res) => {
  res.json(scheduleDatabase);
});

// Get schedule for a specific day
app.get("/schedule/:day", (req, res) => {
  const day = req.params.day;
  if (scheduleDatabase[day]) {
    res.json(scheduleDatabase[day]);
  } else {
    res.status(404).send("Day not found");
  }
});

// Add a new event
app.post("/event", (req, res) => {
  const { day, time, event } = req.body;

  if (!day || !time || !event) {
    return res.status(400).send("Missing required fields");
  }

  if (!scheduleDatabase[day]) {
    return res.status(400).send("Invalid day");
  }

  scheduleDatabase[day].push({ time, event });
  res.status(201).send("Event added successfully");
});

// Delete an event
app.delete("/event", (req, res) => {
  const { day, time } = req.body;

  if (!day || !time) {
    return res.status(400).send("Missing required fields");
  }

  if (!scheduleDatabase[day]) {
    return res.status(400).send("Invalid day");
  }

  const initialLength = scheduleDatabase[day].length;
  scheduleDatabase[day] = scheduleDatabase[day].filter((e) => e.time !== time);

  if (scheduleDatabase[day].length === initialLength) {
    return res.status(404).send("Event not found");
  }

  res.send("Event deleted successfully");
});

// Route to update an event by day and time
// Edit event route
// Edit event route
app.put("/event", async (req, res) => {
  const { day, oldTime, newTime, newEvent } = req.body;

  try {
    // Update the event matching the day and oldTime
    const updated = await Schedule.updateOne(
      { day, time: oldTime },
      { $set: { time: newTime, event: newEvent } }
    );

    if (updated.nModified === 0) {
      return res.status(404).send("Event not found");
    }

    res.status(200).send("Event updated successfully");
  } catch (error) {
    console.error("Error updating event:", error);
    res.status(500).send("Error updating event");
  }
});

// ... (your existing imports and setup)

// Add this right before your other routes (around line 200, before the login route)
const authRouter = express.Router();
authRouter.get("/validate", (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader)
    return res.status(401).json({ message: "No token provided" });

  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    res.status(200).json({ valid: true, user: decoded });
  } catch (err) {
    res.status(401).json({ message: "Invalid or expired token" });
  }
});

// Mount the auth router
app.use("/api/auth", authRouter);

// Route to add devotee
app.post("/api/devotees", upload.single("image"), async (req, res) => {
  try {
    const { name, description } = req.body;
    const imagePath = req.file ? req.file.path : null;

    const newDevotee = new Devotee({
      name,
      description,
      image: imagePath,
    });

    await newDevotee.save();
    res
      .status(201)
      .json({ message: "Devotee added successfully", devotee: newDevotee });
  } catch (error) {
    res.status(500).json({ message: "Server error", error });
  }
});

// Route to get all devotees
app.get("/api/devotees", async (req, res) => {
  try {
    const devotees = await Devotee.find();
    res.status(200).json(devotees);
  } catch (error) {
    res.status(500).json({ message: "Error fetching devotees", error });
  }
});
// const fs = require("fs");

// DELETE devotee by ID
app.delete("/api/devotees/:id", async (req, res) => {
  try {
    const devotee = await Devotee.findById(req.params.id);
    if (!devotee) return res.status(404).json({ message: "Devotee not found" });

    // Delete image from uploads folder
    if (devotee.image && fs.existsSync(devotee.image)) {
      fs.unlinkSync(devotee.image);
    }

    await Devotee.findByIdAndDelete(req.params.id);
    res.status(200).json({ message: "Devotee deleted" });
  } catch (error) {
    res.status(500).json({ message: "Error deleting devotee", error });
  }
});

app.get("/", (req, res) => {
  res.send("Hello from Express!");
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
