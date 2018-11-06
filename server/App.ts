/// <reference path='./ClientConnection.ts' />
import Process = NodeJS.Process;
import Socket from "socket.io";
import {ClientConnection} from "./ClientConnection";
import {EosBlockchain} from "./EosBlockchain";
import {Config} from "./Config";


var process:Process = require('process');
var nodeStatic = require('node-static');
var http = require('http');
var sio = require('socket.io');
var db = require('mysql');

module App {

    export class Main {

        private sio:any = null;

        /**
         * Constructs our App
         */
        constructor() {

            // Grab our port
            let port:number = <number> this.getCliParam("-port", true);
            if (!port) {
                port = 4001;
            }

            // Grab our developer mode
            let developerMode:string = <string> this.getCliParam("-devmode", false);
            if (developerMode) {
                Config.DEVELOPER_MODE = developerMode.toUpperCase() == "TRUE";
            }

            // Create our file server config
            var file = new nodeStatic.Server('public', { // bin is the folder containing our html, etc
                cache: 0,	// don't cache
                gzip: true	// gzip our assets
            });

            // create our server and listen on the specified port
            //
            var httpServer = http.createServer(function (request, response) {
                request.addListener('end', function () {
                    file.serve(request, response);
                });
                request.resume();
            }).listen(port);

            this.sio = sio({"transports": ["websocket"]});
            this.sio.serveClient(true); // the server will serve the client js file
            this.sio.attach(httpServer);

            this.attachEventHandlers();
        }

        // ----------------------------------------------------------------------------
        // LOCAL UTILITY FUNCTIONS
        // ----------------------------------------------------------------------------

        /**
         * Attaches our event handlers
         */
        private attachEventHandlers() : void {

            // Listen for clients connecting
            //
            this.sio.on('connect', (socket:Socket.Socket) => {

                // Spawn new EOS client connection manager for this socket
                new ClientConnection(socket);

            });

            // ============================================================================
            // Handle termination of our process
            // ============================================================================

            // Catch exit event
            process.on('exit', function () {

                for (let i:number = 0; i < ClientConnection.CONNECTIONS.length; i++) {
                    let cc:ClientConnection = ClientConnection.CONNECTIONS[i];
                    let accountInfo:any = cc.getAccountInfo();
                    if (accountInfo) {
                        console.log("Connection with [" + accountInfo.account_name + "] terminated");
                    }
                }
                console.log("EOSRoller Server Exit");

            });

            // catch ctrl+c event and exit normally
            process.on('SIGINT', function () {
                console.log('Ctrl-C...');
                process.exit(2);
            });

            //catch uncaught exceptions, trace, then exit normally
            process.on('uncaughtException', function (e) {
                console.log('Uncaught Exception...');
                console.log(e.stack);
                process.exit(99);
            });
        }

        /**
         * Reads parameters from the command line
         *
         * @param paramName
         * @param isNumber
         * @returns {any}
         */
        private getCliParam(paramName, isNumber): number | string {
            for (var i: number = 0; i < process.argv.length; i++) {
                var val: string = process.argv[i];
                if (val == paramName) {
                    var nextArgIdx = i + 1;
                    if (nextArgIdx < process.argv.length) {
                        if (isNumber) {
                            var val: string = process.argv[nextArgIdx];
                            var valNum: number = parseInt(val);
                            if (!isNaN(valNum)) {
                                return valNum;
                            } else {
                                return null;
                            }
                        } else {
                            return process.argv[nextArgIdx];
                        }
                    }
                }
            }
            return null;
        }

        // ----------------------------------------------------------------------------
        // GENERIC PUBLIC APP-LEVEL STATIC FUNCTIONS
        // ----------------------------------------------------------------------------

    }

}

// Kick things off!
let app:App.Main = new App.Main();