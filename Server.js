const express = require("express");
const Stripe = require("stripe");
const cors = require("cors");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const dotenv = require("dotenv");
const nodemailer = require("nodemailer");

dotenv.config(); // Load environment variables from .env

const app = express();

const JWT_SECRET = process.env.JWT_SECRET;
const MONGO_URI = process.env.MONGO_URI;
const PORT = process.env.PORT || 5000;

// const JWT_SECRET =
//   "e9e3a320bcf6c4700866461e82e1146481259a1e28b57e5999ed248cb700041872d89d149a8bafebd4110778057ac6987aa8be88051062a7bf1f5c89a2615b5b";
// const MONGO_URI =
//   "mongodb+srv://asif:asif1234@owner.rnryq.mongodb.net/Owner?retryWrites=true&w=majority&appName=Owner";
// const PORT = 5000; // Default to 5000 if PORT is not set

// Replace with your Stripe secret key


app.use(cors());
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use("/uploads", express.static("uploads"));

// MongoDB connection
// mongoose.connect(MONGO_URI, {
//   useNewUrlParser: true,
//   useUnifiedTopology: true,
// });
// Remove this duplicate connection:
// mongoose.connect(MONGO_URI, {
//   useNewUrlParser: true,
//   useUnifiedTopology: true,
// });

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
  .then(() => console.log("MongoDB connected"))
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

const Event = mongoose.model("Event", EventSchema);
const User = mongoose.model("User", UserSchema);
const Volunteer = mongoose.model("Volunteer", VolunteerSchema);
const ContactUs = mongoose.model("ContactUs", ContactUsSchema);
const Pledge = mongoose.model("Pledge", pledgeSchema);
const Booking = mongoose.model("Booking", bookingSchema);
// JWT Middleware (for protected routes)

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

// User
// User.findOne({ username: "owner" }).then(async (owner) => {
//   if (!owner) {
//     const hashedPassword = await bcrypt.hash("owner@123", 10);
//     const newOwner = new User({
//       username: "owner",
//       password: hashedPassword,
//       role: "owner",
//     });
//     await newOwner.save();
//     console.log("Owner account created.");
//   }
// });
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
});

const Director = mongoose.model("Director", DirectorSchema);

// Add Director (Only for owner)
app.post("/add-director", authenticateJWT, isOwnerOrAdmin, async (req, res) => {
  const { name, position } = req.body;

  if (!name || !position) {
    return res.status(400).json({ error: "All fields are required" });
  }

  try {
    const newDirector = new Director({ name, position });
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

// Endpoint to send email
// app.post("/send-email", async (req, res) => {
//   const { email, subject, message } = req.body;

//   // Create a transporter object using SMTP
//   // const transporter = nodemailer.createTransport({
//   //   service: "gmail",
//   //   auth: {
//   //     user: "adityavazarkar34@gmail.com", // Replace with your Gmail address
//   //     pass: "kfxw tokw vxwm fjvm", // Use the generated app password here
//   //   },
//   // });
//   const transporter = nodemailer.createTransport({
//     host: "adityavazarkar34@gmail.com",
//     port: 587,
//     secure: false,
//     auth: {
//       user: "adityavazarkar34@gmail.com",
//       pass: "odiw oywl eiyu pspz",
//     },
//   });

//   const mailOptions = {
//     from: "adityavazarkar34@gmail.com", // Replace with your email
//     to: email,
//     subject: subject,
//     text: message,
//   };

//   try {
//     await transporter.sendMail(mailOptions);
//     res.json({ message: "Email sent successfully!" });
//   } catch (error) {
//     console.error("Error sending email:", error); // Log the error details
//     res
//       .status(500)
//       .json({ message: "Error sending email", error: error.message });
//   }
// });

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

app.get("/", (req, res) => {
  res.send("Hello from Express!");
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
