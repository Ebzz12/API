var express = require("express");
var router = express.Router();
const jwt = require("jsonwebtoken");
const JWT_SECRET = process.env.JWT_SECRET;
const bcrypt = require("bcrypt");

router.post("/login", function (req, res, next) {
  const email = req.body.email;
  const password = req.body.password;
  const expires_in = req.body.bearerExpiresInSeconds;
  const refresh_expires_in = req.body.refreshExpiresInSeconds;

  // Verify body
  if (!email || !password) {
    res.status(400).json({
      error: true,
      message: "Request body incomplete, both email and password are required",
    });
    return;
  }

  const queryUsers = req.db
    .from("users")
    .select("*")
    .where("email", "=", email);

  queryUsers
    .then((users) => {
      if (users.length === 0) {
        throw new Error("Incorrect email or password");
      }

      // Compare password hashes
      const user = users[0];
      return bcrypt.compare(password, user.hash);
    })
    .then((match) => {
      if (!match) {
        throw new Error("Incorrect email or password");
      }

      // Generate tokens
      const exp = Math.floor(Date.now() / 1000) + expires_in;
      const token = jwt.sign({ email, exp }, JWT_SECRET);

      const refresh_exp = Math.floor(Date.now() / 1000) + refresh_expires_in;
      const refresh_token = jwt.sign({ email, refresh_exp }, JWT_SECRET);

      req
        .db("users")
        .where({ email })
        .update({ refresh: refresh_token })
        .then(() => {
          // Send the response with tokens
          res.status(200).json({
            bearerToken: {
              token,
              token_type: "Bearer",
              expires_in: exp,
            },
            refreshToken: {
              token: refresh_token,
              token_type: "Refresh",
              expires_in: refresh_exp,
            },
          });
          return;
        });
    })
    .catch((error) => {
      res.status(401).json({
        error: true,
        message: error.message,
      });
      return;
    });
});

router.post("/register", function (req, res, next) {
  // Retrieve email and password from req.body
  const email = req.body.email;
  const password = req.body.password;

  // Verify body
  if (!email || !password) {
    res.status(400).json({
      error: true,
      message: "Request body incomplete, both email and password are required",
    });
    return;
  }

  // Determine if user already exists in table
  const queryUsers = req.db
    .from("users")
    .select("*")
    .where("email", "=", email);
  queryUsers
    .then((users) => {
      if (users.length > 0) {
        throw new Error("User already exists");
      }

      // Insert user into DB
      const saltRounds = 10;
      const hash = bcrypt.hashSync(password, saltRounds);
      return req.db.from("users").insert({ email, hash });
    })
    .then(() => {
      res.status(201).json({ message: "User created" });
    })
    .catch((e) => {
      res.status(500).json({ success: false, message: e.message });
    });
});

router.post("/refresh", function (req, res, next) {
  const { refreshToken } = req.body;
  // Check if the email exists in the request body
  if (!refreshToken) {
    return res.status(400).json({
      error: true,
      message: "Request body incomplete, refresh token required",
    });
  }

  try {
    // Fetch the refresh token from the database based on the email
    req.db
      .from("users")
      .select("refresh")
      .where("refresh", "=", refreshToken)
      .then((users) => {
        if (users.length === 0) {
          throw new Error("User not found");
        }

        const { refresh } = users[0];

        // Verify the refresh token
        const decoded = jwt.verify(refresh, JWT_SECRET);
        if (decoded.refresh_exp < Math.floor(Date.now() / 1000)) {
          return res.status(401).json({
            error: true,
            message: "JWT token has expired",
          });
        }

        console.log("Decoded Refresh Token:", decoded);
        // Get the email from the decoded refresh token
        const { email } = decoded;
        console.log("Email:", email);
        // Generate a new bearer token
        const expires_in = 60 * 10;
        const exp = Math.floor(Date.now() / 1000) + expires_in;
        const token = jwt.sign({ email, exp }, JWT_SECRET);

        // Generate a new refresh token
        const refresh_expires_in = 60 * 60 * 24;
        const refresh_exp = Math.floor(Date.now() / 1000) + refresh_expires_in;
        const new_refresh_token = jwt.sign({ email, refresh_exp }, JWT_SECRET);

        req
          .db("users")
          .where({ email })
          .update({ refresh: new_refresh_token })
          .then(() => {
            // Send the response with the new tokens
            res.status(200).json({
              bearerToken: {
                token,
                token_type: "Bearer",
                expires_in: exp,
              },
              refreshToken: {
                token: new_refresh_token,
                token_type: "Refresh",
                refresh_exp,
              },
            });
          })
          .catch((error) => {
            throw error;
          });
      })
      .catch((error) => {
        res.status(401).json({
          error: true,
          message: error.message,
        });
      });
  } catch (error) {
    // Handle invalid refresh token or token expiration
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        error: true,
        message: "JWT token has expired",
      });
    } else {
      return res.status(401).json({
        error: true,
        message: "Invalid refresh token",
      });
    }
  }
});

router.post("/logout", function (req, res, next) {
  const { refreshToken } = req.body;

  // Check if the refresh token is provided
  if (!refreshToken) {
    return res.status(400).json({
      error: true,
      message: "Request body incomplete, refresh token required",
    });
  }
  const decoded = jwt.verify(refreshToken, JWT_SECRET);
  if (decoded.exp < Math.floor(Date.now() / 1000)) {
    return res.status(401).json({
      error: true,
      message: "JWT token has expired",
    });
  }

  try {
    // Delete the refresh token from the database based on the provided token
    req
      .db("users")
      .where("refresh", refreshToken)
      .update({ refresh: null })
      .then((rowCount) => {
        if (rowCount === 0) {
          throw new Error("Refresh token not found");
        }

        // Send the success response
        res.status(200).json({
          error: false,
          message: "Token successfully invalidated",
        });
      });
  } catch (error) {
    res.status(500).json({
      error: true,
      message: error.message,
    });
  }
});

router.get("/:email/profile", function (req, res, next) {
  const email = req.params.email;

  req.db
    .from("users")
    .select("refresh")
    .where("email", "=", email)
    .then((users) => {
      if (users.length === 0) {
        return res.status(404).json({
          error: true,
          message: "User not found",
        });
      }

      const { refresh } = users[0];

      if (refresh) {
        try {
          const decoded = jwt.verify(refresh, JWT_SECRET);

          req.db
            .from("users")
            .select("email", "firstname", "lastname", "dob", "address")
            .where("email", "=", decoded.email)
            .then((users) => {
              if (users.length === 0) {
                return res.status(404).json({
                  error: true,
                  message: "User not found",
                });
              }

              const user = users[0];
              const userProfile = {
                email: user.email,
                firstname: user.firstname,
                lastname: user.lastname,
                dob: user.dob,
                address: user.address,
              };
              res.status(200).json(userProfile);
            })
            .catch((error) => {
              res.status(500).json({
                error: true,
                message: error.message,
              });
            });
        } catch (error) {
          return res.status(401).json({
            error: true,
            message: "Authorization header ('Bearer token') not found",
          });
        }
      } else {
        req.db
          .from("users")
          .select("email", "firstname", "lastname")
          .where("email", "=", email)
          .then((users) => {
            if (users.length === 0) {
              return res.status(404).json({
                error: true,
                message: "User not found",
              });
            }

            const user = users[0];
            const userProfile = {
              email: user.email,
              firstname: user.firstname,
              lastname: user.lastname,
            };
            res.status(200).json(userProfile);
          })
          .catch((error) => {
            res.status(500).json({
              error: true,
              message: error.message,
            });
          });
      }
    })
    .catch((error) => {
      res.status(500).json({
        error: true,
        message: error.message,
      });
    });
});

router.put("/:email/profile", function (req, res) {
  const email = req.params.email;
  const { firstname, lastname, dob, address } = req.body;

  // Verify the request body
  if (!firstname || !lastname || !dob || !address) {
    res.status(400).json({
      error: true,
      message:
        "Request body incomplete: firstName, lastName, dob, and address are required",
    });
    return;
  }

  // Check if Authorization header is present
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({
      error: true,
      message: "Authorization header ('Bearer token') not found",
    });
    return;
  }

  const token = authHeader.split(" ")[1];

  // Verify the JWT token

  const decoded = jwt.verify(token, JWT_SECRET);

  if (decoded.email !== email) {
    res.status(403).json({
      error: true,
      message: "Forbidden",
    });
    return;
  }
  if (decoded.refresh_exp < Math.floor(Date.now() / 1000)) {
    return res.status(401).json({
      error: true,
      message: "JWT token has expired",
    });
  }

  // Update user profile in the database
  req
    .db("users")
    .where("email", "=", email)
    .update({ firstname, lastname, dob, address })
    .then(() => {
      // Fetch the updated user profile
      return req
        .db("users")
        .select("firstname", "lastname", "dob", "address")
        .where("email", "=", email);
    })
    .then((users) => {
      if (users.length === 0) {
        throw new Error("User not found");
      }

      // Return the updated user profile
      const user = users[0];
      res.status(200).json({
        firstname: user.firstname,
        lastname: user.lastname,
        dob: user.dob,
        address: user.address,
      });
    })
    .catch((error) => {
      if (error.message === "User not found") {
        res.status(404).json({
          error: true,
          message: "User not found",
        });
      } else {
        res.status(500).json({
          error: true,
          message: error.message,
        });
      }
    });
});

module.exports = router;
