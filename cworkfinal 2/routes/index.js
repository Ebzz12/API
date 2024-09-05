var express = require("express");
var router = express.Router();
const authorization = require("../middleware/authorization");

/* GET home page. */
router.get("/", (req, res) => {
  res.redirect("api-docs");
});

router.get("/movies/search", function (req, res, next) {
  const title = req.query.title || ""; // Text to search for in the primary title of the movie
  const year = req.query.year || ""; // The year of initial release of the movie
  const perPage = 100; // Number of results per page (default: 100)

  if (req.query.page && isNaN(req.query.page)) {
    res.status(401).json({
      error: true,
      message: "Invalid page format. page must be a number.",
    });
    return;
  }

  let currentPage = parseInt(req.query.page) || 1; // Current page number (default: 1)

  if (year && !/^\d{4}$/.test(year)) {
    return res.status(400).json({
      error: true,
      message: "Invalid year format. Format must be yyyy.",
    });
  }
  // Calculate the offset based on the current page

  // Create a new Knex query builder
  const query = req.db
    .from("basics")
    .select(
      "primaryTitle as title",
      "year as year",
      "tconst as imdbID",
      "imdbRating as imdbRating",
      "rottentomatoesRating as rottenTomatoesRating",
      "metacriticRating as metacriticRating",
      "rated as classification"
    )
    .where(function () {
      if (title) {
        this.where("primaryTitle", "like", `%${title}%`);
      }
      if (year) {
        this.where("year", year);
      }
    })
    .groupBy(
      "title",
      "year",
      "imdbID",
      "imdbRating",
      "rottenTomatoesRating",
      "metacriticRating",
      "classification"
    )
    .orderBy("ImdbID")
    .paginate({
      perPage: perPage,
      currentPage: currentPage,
      isLengthAware: true,
    });

  // Execute the query to get the paginated results and the total count
  Promise.all([query])
    .then(([{ data: rows, pagination }]) => {
      res.json({ data: rows, pagination });
    })
    .catch((err) => {
      console.log(err);
      res.json({ Error: true, Message: "Error in MySQL query" });
    });
});

router.get("/movies/data/:imdbID", function (req, res, next) {
  const imdbID = req.params.imdbID;

  if (!imdbID) {
    res.status(400).json({
      error: true,
      message:
        "Invalid query parameters: year. Query parameters are not permitted.",
    });
    return;
  }

  const basicsQuery = req.db
    .from("basics")
    .where("tconst", imdbID)
    .select(
      "primaryTitle",
      "year",
      "runtimeMinutes",
      "genres",
      "country",
      "boxoffice",
      "poster",
      "plot"
    )
    .first();

  const principalsQuery = req.db
    .from("principals")
    .where("tconst", imdbID)
    .select("nconst", "category", "name", "characters");

  const ratingsQuery = req.db
    .from("ratings")
    .where("tconst", imdbID)
    .select("source", "value");

  Promise.all([basicsQuery, principalsQuery, ratingsQuery])
    .then(([basicsRow, principalsRows, ratingsRows]) => {
      if (!basicsRow) {
        return res.status(404).json({
          error: true,
          message: "Movie not found.",
        });
      }

      const movieData = {
        title: basicsRow.primaryTitle,
        year: basicsRow.year,
        runtime: basicsRow.runtimeMinutes,
        genres: basicsRow.genres.split(","),
        country: basicsRow.country,
        principals: [],
        ratings: [],
        boxoffice: basicsRow.boxoffice,
        poster: basicsRow.poster,
        plot: basicsRow.plot,
      };

      principalsRows.forEach((row) => {
        movieData.principals.push({
          id: row.nconst,
          category: row.category,
          name: row.name,
          characters: row.characters !== null ? row.characters.split(",") : [],
        });
      });

      ratingsRows.forEach((row) => {
        movieData.ratings.push({
          source: row.source,
          value: row.value,
        });
      });

      res.json(movieData);
    })
    .catch((err) => {
      console.log(err);
      res.json({ Error: true, Message: "Error in MySQL query" });
    });
});

router.get("/people/:id", authorization, function (req, res, next) {
  const id = req.params.id;
  if (!id) {
    res.status(400).json({
      error: true,
      message:
        "Invalid query parameters: year. Query parameters are not permitted.",
    });
    return;
  }
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({
      error: true,
      message: "Authorization header ('Bearer token') not found",
    });
    return;
  }

  req.db
    .from("names")
    .select("primaryName", "birthYear", "deathYear")
    .where("nconst", id)
    .first()
    .then((personRow) => {
      if (!personRow) {
        res.status(404).json({
          error: true,
          message: "No record exists for a person with this ID",
        });
        return;
      } else {
        const data = {
          name: personRow.primaryName,
          birthYear: personRow.birthYear,
          deathYear: personRow.deathYear,
          roles: [],
        };

        req.db
          .from("principals")
          .select(
            "principals.tconst",
            "principals.category",
            "principals.characters",
            "basics.primaryTitle",
            "ratings.source",
            "ratings.value"
          )
          .join("basics", "basics.tconst", "=", "principals.tconst")
          .leftJoin("ratings", "ratings.tconst", "=", "principals.tconst")
          .where("principals.nconst", id)
          .then((rolesRows) => {
            rolesRows.forEach((row) => {
              data.roles.push({
                movieId: row.tconst,
                category: row.category,
                characters:
                  row.characters !== null ? row.characters.split(",") : [],
                movieName: row.primaryTitle,
                imdbRatingSource: row.source,
                imdbRating: row.value,
              });
            });

            res.status(200).json(data);
          })
          .catch((error) => {
            console.error(error);
            res.status(400).json({
              error: true,
              message:
                "An error occurred while retrieving the person's information",
            });
          });
      }
    });
});

module.exports = router;
