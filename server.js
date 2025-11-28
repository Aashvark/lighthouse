const fs         = require("fs");
const path       = require("path");
const fastify    = require("fastify") ( { logger: false } );
const process    = require('node:process');

const handlebars = require("handlebars");

fastify.register(require("@fastify/static"), { root: path.join(__dirname, "public"), prefix: "/" });
fastify.register(require("@fastify/view"), { engine: { handlebars: handlebars } });
fastify.register(require("@fastify/formbody"));

handlebars.logger.level = "debug";

fastify.get("/",  function (request, reply) { return reply.view('/src/index.hbs'); });
fastify.post("/", function (request, reply) {
  let month = new Date(request.body.start).toLocaleString('default', { month: 'long' });
  return reply.view("/src/index.hbs", { text: month });
});

fastify.listen({ port: process.env.PORT || 4000, host: "0.0.0.0" }, function (err, address) { if (err) { console.error(err); process.exit(1); } } );