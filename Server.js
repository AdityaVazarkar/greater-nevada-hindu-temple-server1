import express from "express";
import Stripe from "stripe";
import cors from "cors";
import mongoose from "mongoose";
import bodyParser from "body-parser";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import dotenv from "dotenv";

dotenv.config(); // Load environment variables from .env

const app = express();

const JWT_SECRET = process.env.JWT_SECRET;
const MONGO_URI = process.env.MONGO_URI;
const PORT = process.env.PORT || 5000; // Default to 5000 if PORT is not set

// Replace with your Stripe secret key
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

app.use(cors());
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use("/uploads", express.static("uploads"));

// MongoDB connection
mongoose.connect(MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const db = mongoose.connection;
db.on("error", console.error.bind(console, "connection error:"));
db.once("open", () => {
  console.log("Connected to MongoDB");

  // Check if the owner exists, and create one if not
  User.findOne({ username: "owner" }).then(async (owner) => {
    if (!owner) {
      const hashedPassword = await bcrypt.hash("owner@123", 10);
      const newOwner = new User({
        username: "owner",
        password: hashedPassword,
      });

      newOwner
        .save()
        .then(() => {
          console.log("Owner created successfully");
        })
        .catch((err) => {
          console.error("Error creating owner:", err);
        });
    }
  });
});

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

const Event = mongoose.model("Event", EventSchema);
const User = mongoose.model("User", UserSchema);
const Volunteer = mongoose.model("Volunteer", VolunteerSchema);
const ContactUs = mongoose.model("ContactUs", ContactUsSchema);

// JWT Middleware (for protected routes)
const authenticateJWT = (req, res, next) => {
  const token = req.headers.authorization;
  if (token) {
    const tokenWithoutBearer = token.split(" ")[1];
    jwt.verify(tokenWithoutBearer, JWT_SECRET, (err, user) => {
      if (err) return res.sendStatus(403);
      req.user = user;
      next();
    });
  } else {
    res.sendStatus(401);
  }
};

// Middleware to check if the logged-in user is the owner
const isOwner = (req, res, next) => {
  if (req.user.username !== "owner") {
    return res
      .status(403)
      .send({ error: "Only the owner can perform this action." });
  }
  next();
};

// Routes

// Login route (for owner login)
app.post("/login", async (req, res) => {
  const { username, password } = req.body;

  const user = await User.findOne({ username });
  if (user) {
    const match = await bcrypt.compare(password, user.password);
    if (match) {
      const token = jwt.sign({ username: user.username }, JWT_SECRET, {
        expiresIn: "1h",
      });
      res.json({ token });
    } else {
      res.status(401).send({ error: "Invalid credentials" });
    }
  } else {
    res.status(401).send({ error: "Invalid credentials" });
  }
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
app.post("/create-event", authenticateJWT, isOwner, async (req, res) => {
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

// Update Event route (Only for owner)
// app.put("/update-event/:id", authenticateJWT, isOwner, async (req, res) => {
//   try {
//     await Event.findByIdAndUpdate(req.params.id, req.body);
//     res.send({ message: "Event updated successfully" });
//   } catch (error) {
//     res.status(500).send({ error: error.message });
//   }
// });

// // Delete Event route (Only for owner)
// app.delete("/delete-event/:id", authenticateJWT, isOwner, async (req, res) => {
//   try {
//     await Event.findByIdAndDelete(req.params.id);
//     res.send({ message: "Event deleted successfully" });
//   } catch (error) {
//     res.status(500).send({ error: error.message });
//   }
// });

// Update Event route (Only for owner)
app.put("/update-event/:id", authenticateJWT, isOwner, async (req, res) => {
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
});

// Delete Event route (Only for owner)
app.delete("/delete-event/:id", authenticateJWT, isOwner, async (req, res) => {
  try {
    const event = await Event.findByIdAndDelete(req.params.id);
    if (!event) {
      return res.status(404).send({ error: "Event not found" });
    }
    res.send({ message: "Event deleted successfully" });
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

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

// Add Director Schema
const DirectorSchema = new mongoose.Schema({
  name: String,
  position: String,
  image: String, // Store image URL (or path if storing locally)
});

const Director = mongoose.model("Director", DirectorSchema);

// Middleware for file upload (image)
import multer from "multer";
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/"); // Directory to save images
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname); // Unique file name
  },
});

const upload = multer({ storage });

// Add Director route (Only for owner)
app.post(
  "/add-director",
  authenticateJWT,
  isOwner,
  upload.single("image"),
  async (req, res) => {
    const { name, position } = req.body;
    const image = req.file ? req.file.path : null; // Path to the uploaded image

    if (!name || !position || !image) {
      return res
        .status(400)
        .send({ error: "All fields are required, including the image" });
    }

    try {
      const newDirector = new Director({
        name,
        position,
        image,
      });
      await newDirector.save();
      res.status(201).send({ message: "Director added successfully" });
    } catch (error) {
      res.status(500).send({ error: error.message });
    }
  }
);

// Get Directors route (Public access)
app.get("/directors", async (req, res) => {
  try {
    const directors = await Director.find({}); // Add validation for event creation
    const validateEvent = (req, res, next) => {
      const { title, description, date, time, venue } = req.body;
      if (!title || !description || !date || !time || !venue) {
        return res.status(400).send({ error: "All fields are required" });
      }
      next();
    };

    // Create Event route (Only for owner)
    app.post(
      "/create-event",
      authenticateJWT,
      isOwner,
      validateEvent,
      async (req, res) => {
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
      }
    );

    // Add validation for event update
    const validateEventUpdate = (req, res, next) => {
      const { title, description, date, time, venue } = req.body;
      if (!title && !description && !date && !time && !venue) {
        return res
          .status(400)
          .send({ error: "At least one field is required" });
      }
      next();
    };

    // Update Event route (Only for owner)
    app.put(
      "/update-event/:id",
      authenticateJWT,
      isOwner,
      validateEventUpdate,
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

    // Add validation for volunteer data
    const validateVolunteer = (req, res, next) => {
      const { name, email, phone, address, interest, message } = req.body;
      if (!name || !email || !phone || !address || !interest || !message) {
        return res.status(400).send({ error: "All fields are required" });
      }
      next();
    };

    // Save Volunteer Data (Post route)
    app.post("/save-volunteer", validateVolunteer, async (req, res) => {
      const { name, email, phone, address, interest, message } = req.body;

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

    // Add validation for contact us data
    const validateContactUs = (req, res, next) => {
      const { name, email, message } = req.body;
      if (!name || !email || !message) {
        return res.status(400).send({ error: "All fields are required" });
      }
      next();
    };

    // Save Contact Us Data (Post route)
    app.post("/contact-us", validateContactUs, async (req, res) => {
      const { name, email, message } = req.body;

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

    // Add validation for director data
    const validateDirector = (req, res, next) => {
      const { name, position } = req.body;
      if (!name || !position) {
        return res.status(400).send({ error: "All fields are required" });
      }
      next();
    };

    // Add Director route (Only for owner)
    app.post(
      "/add-director",
      authenticateJWT,
      isOwner,
      upload.single("image"),
      validateDirector,
      async (req, res) => {
        const { name, position } = req.body;
        const image = req.file ? req.file.path : null; // Path to the uploaded image
        const imagePath = req.file ? `uploads/${req.file.filename}` : null;

        if (!image) {
          return res.status(400).send({ error: "Image is required" });
        }

        try {
          const newDirector = new Director({
            name,
            position,
            image,
          });
          await newDirector.save();
          res.status(201).send({ message: "Director added successfully" });
        } catch (error) {
          res.status(500).send({ error: error.message });
        }
      }
    );
    res.send(directors);
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

// Update Director route (Only for owner)
// Update Director route (Only for owner)
app.put(
  "/update-director/:id",
  authenticateJWT,
  isOwner,
  upload.single("image"), // Optional: If the owner wants to upload a new image
  async (req, res) => {
    const { name, position } = req.body;
    const image = req.file ? req.file.path : null; // New image path if provided

    try {
      const director = await Director.findById(req.params.id);
      if (!director) {
        return res.status(404).send({ error: "Director not found" });
      }

      // Update fields with the provided data
      director.name = name || director.name;
      director.position = position || director.position;
      if (image) director.image = image; // Update the image only if a new one is uploaded

      await director.save();
      res.send({ message: "Director updated successfully" });
    } catch (error) {
      res.status(500).send({ error: error.message });
    }
  }
);

// Delete Director route (Only for owner)
app.delete(
  "/delete-director/:id",
  authenticateJWT,
  isOwner,
  async (req, res) => {
    try {
      const director = await Director.findByIdAndDelete(req.params.id);
      if (!director) {
        return res.status(404).send({ error: "Director not found" });
      }
      res.send({ message: "Director deleted successfully" });
    } catch (error) {
      res.status(500).send({ error: error.message });
    }
  }
);

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  // console.log(
  //   `Server is running on https://greater-nevada-hindu-temple-server1.onrender.com`
  // );
});
