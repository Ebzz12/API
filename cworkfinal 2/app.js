const swaggerUI = require("swagger-ui-express");
const swaggerDocument = require("./docs/swagger.json");
const createError = require("http-errors");
const express = require("express");
const path = require("path");
const cookieParser = require("cookie-parser");
const logger = require("morgan");
require("dotenv").config();

const indexRouter = require("./routes/index");
const usersRouter = require("./routes/users");
const options = require("./knexfile.js");
const knex = require("knex")(options);
const { attachPaginate } = require("knex-paginate");
attachPaginate();
const cors = require("cors");

const app = express();

app.set("views", path.join(__dirname, "views"));
app.set("view engine", "jade");

app.use(logger("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));
app.use(cors());
app.use((req, res, next) => {
  req.db = knex;
  next();
});

app.use("/", indexRouter);
app.use("/user", usersRouter);
app.use("/api-docs", swaggerUI.serve, swaggerUI.setup(swaggerDocument));

app.get("/knex", function (req, res, next) {
  req.db
    .raw("SELECT VERSION()")
    .then((version) => console.log(version[0][0]))
    .catch((err) => {
      console.log(err);
      throw err;
    });
  res.send("Version Logged successfully");
});

app.use(function (req, res, next) {
  next(createError(404));
});

app.use(function (err, req, res, next) {
  // Set HTTP status for the error
  res.status(err.status || 500);

  // Set the JSON response
  res.json({
    error: true,
    message: err.message,
  });
});

module.exports = app;
