const click = require("./tools/click");
const type = require("./tools/type");
const read = require("./tools/read");
const navigate = require("./tools/navigate");

module.exports = {
  execute(ctx, tool, args) {
    return require(`./tools/${tool}`)(ctx, args);
  },
};
