///<reference path="../node_modules/@types/jquery/index.d.ts" />
///<reference path="../node_modules/@types/socket.io/index.d.ts" />

import {Socket} from "socket.io";
import {SocketMessage} from "../server/SocketMessage";
import {Config, ViewState} from "./config";
import {EOS_NETWORK, GUIManager} from "./GUIManager";
import {FaucetManager} from "./FaucetManager";
import {AuctionManager} from "./AuctionManager";
import {DividendManager} from "./DividendManager";

module EOSTime {

    // Defined in the scatterjs-core js file, which is required
    declare var ScatterJS:any;

    // Defined by socket.io.js
    declare var io:any;

    // Defined by
    declare var Eos:any;

    export class Main {

        private eos:any = null;
        private identity:any = null;
        private account:any = null;
        private accountInfo:any = null;
        private hasScatter:boolean = false;
        private socketMessage:SocketMessage = null;
        private guiManager:GUIManager = null;
        private loginInProgress:boolean = false;
        private auctionManager:AuctionManager = null;
        private faucetManager:FaucetManager = null;
        private dividendManager:DividendManager = null;

        private eosNetwork:string = "mainnet"; // "mainnet" or "jungle";

        /**
         * Class constructor. Simply creates our _webpage object and calls its
         * onPageLoad method. Optionally kills console.log messages (if set
         * in Globals).
         */
        constructor() {

            console.log('================================');
            console.log('========== EosRoller ===========');
            console.log('========= version 0.1 ==========');
            console.log('================================');
            window.addEventListener('load', (event) => {

                // Kill console logging if so desired.
                // console.log = (message?:any, ...optionalParams: any[]) => {};

                this.extendJQuery();

                // Load the remainder of the page
                this.loadComponents().then(() => {

                    // Grab our initial EOS network
                    let savedEOSNetwork:string = localStorage.getItem(Config.LOCAL_STORAGE_KEY_EOS_NETWORK);
                    if (savedEOSNetwork) {
                        this.eosNetwork = savedEOSNetwork;
                    } else {
                        localStorage.setItem(Config.LOCAL_STORAGE_KEY_EOS_NETWORK, this.eosNetwork);
                    }

                    // The first thing we do is connect to the API server
                    let apiServer:string = Config.API_SERVER.host + ":" + Config.API_SERVER.port.toString();
                    let socket: Socket = io(apiServer, {transports: ['websocket'], upgrade: false, "forceNew": true});
                    this.socketMessage = new SocketMessage(socket);
                    this.attachSocketListeners(socket);

                    // Create our GUI manager
                    this.guiManager = new GUIManager();
                    this.attachGUIListeners();

                    // Create needed page handler objects
                    this.createPageHandlers();

                    // Let all know that we are logged out
                    this.updateViewState(ViewState.LOGGED_OUT);

                    // Handle the API server connection
                    $(document).on("apiServerConnect", (event) => {

                        // Once we have connected to the server, go and get the active auctions
                        // and display them. This does not require Scatter or login
                        let evt:CustomEvent = new CustomEvent("initializeGameGUI", {});
                        document.dispatchEvent(evt);

                        // Now try to log-in
                        ScatterJS.scatter.connect("eostime", {initTimeout: 10000}).then((connected) => {
                            this.hasScatter = connected;
                            if (!connected) {
                                // TODO NEEDS TO INSTALL SCATTER
                            } else {
                                // Try to login
                                if (ScatterJS.scatter.identity) {
                                    this.login();
                                }
                            }
                        }).catch((err) => {
                            console.log("Error connecting with scatter!")
                        });
                    });

                }).catch((err) => {
                    console.log(err);
                });

            });
        }

        /**
         * Loads common page components
         * @param {(err: Error) => void} callback
         */
        private loadComponents():Promise<any> {
            let siteMenu:Promise<any> = new Promise((resolve, reject) => {
                $("#site_menu").load('components/menu.html', function(response, status, xhr) {
                    if ( status == "error" ) {
                        var msg = "Error loading the menu component: " + xhr.status + " " + xhr.statusText;
                        reject(new Error(msg));
                    } else {

                        // Update the active class in the menu
                        if ((window.location.pathname == "/") || (window.location.pathname.indexOf("index") >= 0) || (window.location.pathname.indexOf("eostime") >= 0)) {
                            $(".home-nav-link").addClass("active");
                        } else if (window.location.pathname.indexOf("faucet") >= 0) {
                            $(".faucet-nav-link").addClass("active");
                        } else if (window.location.pathname.indexOf("airdrops") >= 0) {
                            $(".airdrops-nav-link").addClass("active");
                        } else if (window.location.pathname.indexOf("referrals") >= 0) {
                            $(".referrals-nav-link").addClass("active");
                        } else if (window.location.pathname.indexOf("dividend") >= 0) {
                            $(".dividend-nav-link").addClass("active");
                        }

                        resolve();
                    }
                });
            });

            let siteFooter:Promise<any> = new Promise((resolve, reject) => {
                $("#footer_container").load('components/footer.html', function(response, status, xhr) {
                    if ( status == "error" ) {
                        var msg = "Error loading the footer component: " + xhr.status + " " + xhr.statusText;
                        reject(new Error(msg));
                    } else {
                        resolve();
                    }
                });
            });

            return Promise.all([siteMenu, siteFooter]);
        }

        /**
         * Adds animation capability to JQuery
         */
        private extendJQuery():void {
            $.fn.extend({
                animateCss: function(animationName, callback) {
                    var animationEnd = (function(el) {
                        var animations = {
                            animation: 'animationend',
                            OAnimation: 'oAnimationEnd',
                            MozAnimation: 'mozAnimationEnd',
                            WebkitAnimation: 'webkitAnimationEnd',
                        };

                        for (let t in animations) {
                            if (el.style[t] !== undefined) {
                                return animations[t];
                            }
                        }
                    })(document.createElement('div'));

                    this.addClass('animated ' + animationName).one(animationEnd, function() {
                        $(this).removeClass('animated ' + animationName);

                        if (typeof callback === 'function') callback();
                    });

                    return this;
                },
            });
        }

        /**
         * Create page handler objects depending on what page we are on.
         */
        private createPageHandlers():void {

            // Home Page
            if ((window.location.pathname == "/") || (window.location.pathname.indexOf("index") >= 0) || (window.location.pathname.indexOf("eostime") >= 0)) {
                this.auctionManager = new AuctionManager(this.socketMessage, this.guiManager);
            } else {
                // Faucet page
                if (window.location.pathname.indexOf("faucet") >= 0) {
                    this.faucetManager = new FaucetManager(this.socketMessage, this.guiManager);
                } else if (window.location.pathname.indexOf("dividend") >= 0) {
                    this.dividendManager = new DividendManager(this.socketMessage, this.guiManager);
                }
            }
            this.guiManager.notifyCurrentLanguage();
        }

        /**
         * Disconnects from the API server
         */
        private disconnectFromApiServer():void {
            if (this.socketMessage) {
                this.socketMessage.destroy();
                this.socketMessage = null;
            }
        }

        /*
         * Clears everything that needs to be when we log out
         */
        private clearScatterReferences():void {
            this.identity = null;
            this.account = null;
            this.accountInfo = null;
            this.eos = null;

            let evt:CustomEvent = new CustomEvent("updateEos", {"detail": this.eos});
            document.dispatchEvent(evt);
        }

        /**
         * Logs the user in if he is not already logged in
         * @param {() => {}} onLoggedIn
         */
        private login(onLoggedIn:() => {} = null):Promise<any> {

            if (this.hasScatter && !this.loginInProgress && (this.account == null)) {

                this.loginInProgress = true;

                if (this.eos == null) {
                    // Save a proxy instance of Eos library that integrates with scatter for signatures and transactions.
                    this.eos = ScatterJS.scatter.eos(Config.SCATTER_NETWORK[this.eosNetwork], Eos, {"chainId": Config.SCATTER_NETWORK[this.eosNetwork].chainId}, 'https');

                    let evt:CustomEvent = new CustomEvent("updateEos", {"detail": this.eos});
                    document.dispatchEvent(evt);
                }

                if (!this.identity) {
                    return new Promise((resolve) => {
                        this.identity = ScatterJS.scatter.identity;
                        if (!this.identity) {
                            let network: any = Config.SCATTER_NETWORK[this.eosNetwork];
                            ScatterJS.scatter.getIdentity({accounts: [Config.SCATTER_NETWORK[this.eosNetwork]]}).then((identity) => {
                                resolve(identity);
                            }).catch((err) => {
                               // User declined giving us an identity
                               //
                               resolve(null);
                            });
                        } else {
                            resolve(this.identity);
                        }
                    }).then((identity: any) => {
                        this.identity = identity;
                        if (this.identity) {
                            this.account = this.identity.accounts.find(acc => acc.blockchain === 'eos');
                            if (this.account) {
                                this.loginInProgress = false;
                                ScatterJS.scatter.authenticate().then((sig: string) => {
                                    const urlParams:any = new URLSearchParams(window.location.search);
                                    const referrer:string = urlParams.get('ref');  // Comes back null if none - which is OK!
                                    this.guiManager.updateReferralLink(this.account.name);
                                    this.socketMessage.ctsEOSAccount(this.account, referrer, this.eosNetwork, location.host, this.identity.publicKey, sig);
                                }).catch(error => {
                                    this.account = null;
                                    // TODO HANDLE Authentication Failed!
                                });
                            } else {
                                this.loginInProgress = false;
                                // TODO NEEDS EOS ACCOUNT IN SELECTED IDENTITY
                            }
                        } else {
                            this.loginInProgress = false;
                            // TODO NEEDS SCATTER IDENTITY
                        }
                    }).catch((reason: any) => {
                        this.loginInProgress = false;
                        // TODO HANDLE UNKNOWN CLIENT LOGIN PROBLEM
                        console.log("HANDLE UNKNOWN CLIENT LOGIN PROBLEM");
                        console.log(reason);
                    });
                } else {
                    this.loginInProgress = false;
                    return Promise.resolve();
                }
            } else {
                return Promise.resolve();
            }
        }

        /**
         * Logs the user out
         * @returns {Promise<any>}
         */
        private logout():Promise<any> {
            this.updateViewState(ViewState.LOGGED_OUT);
            this.guiManager.updateEOSBalance("0");
            this.guiManager.updateCoinBalance("0");
            this.clearScatterReferences();
            if (ScatterJS.scatter.identity) {
                return ScatterJS.scatter.forgetIdentity();
            } else {
                return Promise.resolve();
            }
        }

        /**
         * Updates our view state
         * @param {ViewState} state
         * @param {number} cpu
         * @param {number} net
         */
        private updateViewState(state:ViewState, cpu:number = null, net: number = null):void {
            if (state == ViewState.LOGGED_IN) {
                this.updateCoinBalances();
                this.guiManager.showEOSStakedResources(true, cpu, net);
            } else {
                this.guiManager.showEOSStakedResources(false, null, null);
            }
            let data:any = {"viewState" : state, "account": this.account, "accountInfo": this.accountInfo};
            let evt:CustomEvent = new CustomEvent("updateViewState", {"detail": data});
            document.dispatchEvent(evt);
        }

        // Grabs the current balance of all coins
        private updateCoinBalances():void {
            this.eos.getCurrencyBalance("eosio.token", this.account.name, "EOS").then((result:string[]) => {
                let eosBalance = result.find(currency => currency.indexOf('EOS') >= 0);
                if (eosBalance) {
                    eosBalance = parseFloat(eosBalance).toFixed(4);
                    this.guiManager.updateEOSBalance(eosBalance);
                }
                this.eos.getCurrencyBalance(Config.TIME_TOKEN_CONTRACT, this.account.name, Config.TIME_TOKEN_SYMBOL).then((result:string[]) => {
                    let coinBalance = result.find(currency => currency.indexOf(Config.TIME_TOKEN_SYMBOL) >= 0);
                    if (coinBalance) {
                        coinBalance = parseFloat(coinBalance).toFixed(4);
                        this.guiManager.updateCoinBalance(coinBalance);
                    } else {
                        this.guiManager.updateCoinBalance("0.0000");
                    }
                });
            }).catch(error => console.error(error));
        }

        /**
         * Attach event handlers that listen for API messages
         */
        private attachSocketListeners(socket:Socket):void {

            // Sent from server to indicate the server has registered this client
            socket.on(SocketMessage.STC_CLIENT_CONNECTED, (data:any) => {

                console.log("Connected to API server");
                let evt:CustomEvent = new CustomEvent("apiServerConnect", {"detail": ""});
                document.dispatchEvent(evt);

            });

            // Time to update our coin balances
            socket.on(SocketMessage.STC_UPDATE_BALANCES, (data:any) => {
                let evt:CustomEvent = new CustomEvent("updateCoinBalances", {});
                document.dispatchEvent(evt);
            });

            // Sent from the server in response to CTS_EOS_ACCOUNT with more complete
            // information on the currently logged in account. The object we get is:
            //
            // {
            //   "timestamp": 1540933501,
            //   "account_name": "chassettny11",
            //   "head_block_num": 24375484,
            //   "head_block_time": "2018-10-30T21:05:01.000",
            //   "privileged": false,
            //   "last_code_update": "1970-01-01T00:00:00.000",
            //   "created": "2018-10-23T21:17:46.000",
            //   "core_liquid_balance": "2.9677 EOS",
            //   "ram_quota": 4455,
            //   "net_weight": 500,
            //   "cpu_weight": 553900,
            //   "net_limit": {
            //     "used": 492,
            //     "available": 33609,
            //     "max": 34101
            //   },
            //   "cpu_limit": {
            //     "used": 2387,
            //     "available": 6811959,
            //     "max": 6814346
            //   },
            //   "ram_usage": 3574,
            //   "permissions": [
            //     {
            //       "perm_name": "active",
            //       "parent": "owner",
            //       "required_auth": {
            //         "threshold": 1,
            //         "keys": [
            //           {
            //             "key": "EOS7rxXxrYRGqzKBh2DjQh7ZCC6TLTHFQgoUqYdBmLYUpzBa1HWcd",
            //             "weight": 1
            //           }
            //         ],
            //         "accounts": [],
            //         "waits": []
            //       }
            //     },
            //     {
            //       "perm_name": "owner",
            //       "parent": "",
            //       "required_auth": {
            //         "threshold": 1,
            //         "keys": [
            //           {
            //             "key": "EOS63Sq4dDaqLkz1h2yRv8CRfyxwGajU27kHxVWn3XztPPt8bL7Bt",
            //             "weight": 1
            //           }
            //         ],
            //         "accounts": [],
            //         "waits": []
            //       }
            //     }
            //   ],
            //   "total_resources": {
            //     "owner": "chassettny11",
            //     "net_weight": "0.0500 EOS",
            //     "cpu_weight": "55.3900 EOS",
            //     "ram_bytes": 3055
            //   },
            //   "self_delegated_bandwidth": {
            //     "from": "chassettny11",
            //     "to": "chassettny11",
            //     "net_weight": "0.0500 EOS",
            //     "cpu_weight": "0.1500 EOS"
            //   },
            //   "refund_request": null,
            //   "voter_info": {
            //     "owner": "chassettny11",
            //     "proxy": "",
            //     "producers": [],
            //     "staked": 2000,
            //     "last_vote_weight": "0.00000000000000000",
            //     "proxied_vote_weight": "0.00000000000000000",
            //     "is_proxy": 0
            //   }
            // }
            //
            socket.on(SocketMessage.STC_ACCOUNT_INFO, (data: any) => {
                this.accountInfo = JSON.parse(data);
                let referrerEvt:CustomEvent = new CustomEvent("setReferrer", {"detail": this.accountInfo.referrer});
                document.dispatchEvent(referrerEvt);
                let userLogInEvt:CustomEvent = new CustomEvent("userLogIn", {"detail": this.accountInfo});
                document.dispatchEvent(userLogInEvt);

                let cpu:number = Math.floor(this.accountInfo.cpu_limit.used*100/this.accountInfo.cpu_limit.max);
                let net:number = Math.floor(this.accountInfo.net_limit.used*100/this.accountInfo.net_limit.max);
                this.updateViewState(ViewState.LOGGED_IN, cpu, net);
            });

            // Indicates the server wants this client to operate in developer mode
            socket.on(SocketMessage.STC_DEV_MODE, (data:any) => {
                this.guiManager.enableDevGui();
                this.guiManager.updateConnectedNetwork(this.eosNetwork == "mainnet" ? EOS_NETWORK.MAINNET : EOS_NETWORK.JUNGLE);
            });

            // Server has sent a developer error message
            socket.on(SocketMessage.STC_DEV_ERROR, (data:any) => {
                data = JSON.parse(data);
                this.guiManager.onDevError(data.message);
            });

            // Server wants us to clear developer error messages
            socket.on(SocketMessage.STC_CLEAR_DEV_ERRORS, (data:any) => {
                this.guiManager.onClearDevErrors();
            });

            // Server has sent an error message
            socket.on(SocketMessage.STC_ERROR, (data:any) => {
                data = JSON.parse(data);
                this.guiManager.onError(data.message);
            });

        }

        /**
         * Attaches listeners to the GUI
         */
        private attachGUIListeners():void  {

            $(document).on("updateCoinBalances", (event) => {
                this.updateCoinBalances();
            });

            $(document).on("selectNetwork", (event) => {

                // Switch networks
                if (this.eosNetwork != event.detail.toString()) {
                    this.logout().then(() => {
                        this.eosNetwork = event.detail.toString();
                        this.login();
                        localStorage.setItem(Config.LOCAL_STORAGE_KEY_EOS_NETWORK, this.eosNetwork);
                    });
                }
            });

            $(document).on("logIn", (event) => {
                this.login();
            });

            $(document).on("logOut", (event) => {
                this.logout();
            });
        }

    }
}

// Create a single instance of our page handler
let EOSRollerInstance = new EOSTime.Main();