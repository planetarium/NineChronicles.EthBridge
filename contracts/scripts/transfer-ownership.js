module.exports = function(callback) {
    const WrappedNCG = artifacts.require("WrappedNCG");

    console.log(process.argv[6]);
    WrappedNCG.deployed()
        .then((WNCG) => WNCG.transferOwnership(process.argv[6]))
        .then(_ => callback())
        .catch(console.error);
}
