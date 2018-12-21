import {DBManager} from "./DBManager";

module ActionScraperApp {

    export class Main {

        private dbManager:DBManager = null;

        constructor() {

            const historyEndpoint: string = <string> process.env.HISTORY_RPC_ENDPOINT;
            if (!historyEndpoint) {
                console.log("No history RPC endpoint specified - please define HISTORY_RPC_ENDPOINT environment var");
                process.exit();
            }

            const db:string = <string> process.env.MONGO_DATABASE;
            const username:string = <string> process.env.MONGO_USERNAME;
            const password:string = <string> process.env.MONGO_PASSWORD;
            if (db && password && password) {
                this.dbManager = new DBManager();
            } else {
                console.log("Cannot connect to database");
                process.exit();
            }

            this.dbManager.openDbConnection(db, username, password).then((result) => {

            }).catch((err) => {
                console.log("Error opening the database");
                console.log(err);
            })
        }
    }
}

// Kick things off!
let app:ActionScraperApp.Main = new ActionScraperApp.Main();