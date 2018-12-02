import Socket from "socket.io";
import iplocation from "iplocation";
import {SocketMessage} from "./SocketMessage";
import {EosBlockchain} from "./EosBlockchain";
import {Config} from "./Config";
import {DBManager} from "./DBManager";
import {AuctionManager} from "./AuctionManager";
import {DividendManager} from "./DividendManager";

const moment = require('moment');

export class ClientConnection {

    // Global that holds all active client connections
    public static CONNECTIONS:ClientConnection[] = new Array<ClientConnection>();

    // Private class members
    private ipAddress;
    private socketMessage:SocketMessage;
    private eos: () => EosBlockchain;
    private network:string = null;
    private accountInfo:any = null;
    private dbManager:DBManager = null;
    private auctionManager:AuctionManager = null;
    private dividendManager:DividendManager = null;
    private static GEOLOCATION_PROVIDERS:string[] = null;

    // Used to handle someone banging at the faucet
    private static faucetCache:any = {};

    public static socketMessageFromAccountName(accountName:string):SocketMessage {
        let clientConnection:ClientConnection = ClientConnection.CONNECTIONS.find((val) => {
            let accountNameToCompare:string = Config.safeProperty(val, ["accountInfo.account_name"], null);
            return (accountNameToCompare == accountName);
        });
        if (clientConnection) {
            return clientConnection.socketMessage;
        } else {
            return null;
        }
    }

    /**
     * Constructor
     * @param {SocketIO.Socket} _socket
     * @param {DBManager} dbManager
     * @param {AuctionManager} auctionManager
     * @param {DividendManager} dividendManager
     * @param {() => EosBlockchain} eos
     */
    constructor(_socket:Socket.Socket, dbManager:DBManager, auctionManager:AuctionManager, dividendManager:DividendManager, eos: () => EosBlockchain) {

        this.dbManager = dbManager;
        this.auctionManager = auctionManager;
        this.dividendManager = dividendManager;
        this.eos = eos;

        if (!this.isBlockedIPAddress(_socket.handshake.address)) {
            this.ipAddress = _socket.handshake.address;
            // Setup this ClientConnection
            this.socketMessage = new SocketMessage(_socket);
            this.attachAPIHandlers();

            // Add ourselves to the active list of connections
            ClientConnection.CONNECTIONS.push(this);

            // Let the client know that we are connected
            this.socketMessage.stcConnected();

        } else {
            // Kill the socket and associated resources
            _socket.disconnect();
        }
    }

    /**
     * Returns the socket associated with this connection
     * @returns {SocketIO.Socket}
     */
    public getSocket():Socket.Socket {
        return this.socketMessage.getSocket();
    }

    /**
     * Returns our socket message object
     * @returns {SocketMessage}
     */
    public getSocketMessage():SocketMessage {
        return this.socketMessage;
    }

    /**
     * Getter for accountInfo member
     * @returns {any}
     */
    public getAccountInfo():any {
        return this.accountInfo;
    }

    public sendDevMessage(message:string):void {
        this.socketMessage.stcDevMessage(message);
    }

    /**
     * Sends new accountInfo object to client
     * @param accountName
     */
    public sendAccountInfo(accountName:string, referrer:string):void {
        // Send EOS account info to the client
        let retryCount:number = 0;
        const getAccoutFromBlockchain = function() {
            // Send account information to the client
            this.eos().getAccount(accountName).then((accountInfo: any) => {
                this.accountInfo = accountInfo;
                return this.eos().getBalance(this.accountInfo.account_name, "eostimetoken", "TIME");
            }).then((data: any) => {
                let timeBalance:string = data.length == 1 && data[0].length > 1 ? data[0] : "0.0000 TIME";
                this.accountInfo.timeBalance = timeBalance;
                return this.registerClientAccount(this.accountInfo, referrer);
            }).then((data: any) => {
                this.socketMessage.stcDevMessage("Sent account info for " + this.accountInfo.account_name + " to client");
                this.socketMessage.stcAccountInfo(this.accountInfo);
            }).then((data:any) => {

            }).catch((err: any) => {
                if (err) {
                    if (err.status == 500) {
                        // TODO ADD THE SOCKET'S IP TO THE BLOCKED LIST BECAUSE THE ACCOUNT
                        console.log("BAD ACCOUNT");
                    } else if (err.status == 429) {
                        // Indicates too many requests out to EOS blockchain, try
                        // again in 1 second up to five times.
                        retryCount++;
                        if (retryCount < 5) {
                            let localThis:ClientConnection = this;
                            return new Promise(function(resolve) {
                                setTimeout(() => {
                                    localThis.socketMessage.stcDevMessage("Retry #" + retryCount.toString() + " EOSjs getAccount()");
                                    getAccoutFromBlockchain();
                                }, 1000);
                            });
                        } else {
                            this.socketMessage.stcDevMessage("EOSjs getAccount(" + accountName + ") Too many requests failure");
                        }
                    } else if (err.message) {
                        this.socketMessage.stcDevMessage(err.message);
                    } else {
                        this.socketMessage.stcDevMessage("Unknown error EOSjs getAccount(" + accountName + ")");
                    }
                } else {
                    this.socketMessage.stcDevMessage("NULL error EOSjs getAccount(" + accountName + ")");
                }
            });
        }.bind(this);
        this.socketMessage.stcDevMessage("Retrieving account information for " + accountName + " from EOS");
        getAccoutFromBlockchain();
    }

    /**
     * Public method to return the geolocation of a specific IP address
     *
     * OBJECT RETURNED LOOKS LIKE THIS:
     * {
     *   "country": "United States",
     *   "countryCode": "US",
     *   "region": "Massachusetts",
     *   "regionCode": "MA",
     *   "city": "Wellesley Hills",
     *   "postal": "02481",
     *   "ip": "108.20.173.186",
     *   "latitude": 42.3106,
     *   "longitude": -71.2747,
     *   "timezone": "America/New_York"
     * }
     *
     * @param {string} ipAddress
     * @returns {Promise<any>}
     */
    public geolocateIPAddress(ipAddress:string):Promise<any> {
        return new Promise((resolve, reject) => {
            if (!ClientConnection.GEOLOCATION_PROVIDERS) {
                this.dbManager.getDocumentByKey("applicationSettings", {key: "geolocProviders"}).then((result) => {
                    if (result) {
                        ClientConnection.GEOLOCATION_PROVIDERS = result.value;
                        iplocation(ipAddress, ClientConnection.GEOLOCATION_PROVIDERS, (error, res) => {
                            if (error) {
                                reject(error);
                            } else {
                                resolve(res);
                            }
                        });
                    } else {
                        console.log("Could not get application key 'geolocProviders'");
                        resolve(null);
                    }
                }).catch((reason) => {
                    console.log("Could not get application key 'geolocProviders'");
                    resolve(null);
                });
            } else {
                iplocation(ipAddress, ClientConnection.GEOLOCATION_PROVIDERS, (error, res) => {
                    if (error) {
                        reject(error);
                    } else {
                        resolve(res);
                    }
                });
            }
        });
    }

    /**
     * Attaches handlers for API messages sent by the client
     */
    private attachAPIHandlers():void {

        let socket:Socket.Socket = this.socketMessage.getSocket();

        // Handle the disconnect of the client
        socket.on("disconnect", () => {
            // Remove this socket from our active list
            for (let i:number = 0; i < ClientConnection.CONNECTIONS.length; i++) {
                let cs:ClientConnection = ClientConnection.CONNECTIONS[i];
                if (socket.id == cs.socketMessage.getSocket().id) {
                    ClientConnection.CONNECTIONS.splice(i, 1);
                    if (this.accountInfo) {
                        let timestamp:string = moment().format();
                        console.log("[" + this.accountInfo.account_name + "] DISCONNECTED at " + timestamp);
                    }
                    break;
                }
            }
        });

        // Sent when the client knows the EOS account associated with this socket
        socket.on(SocketMessage.CTS_EOS_ACCOUNT, (payload:any) => {

            // TODO Need to verify the expected properties of data

            // Put the client in developer mode
            if (Config.DEVELOPER_MODE) {
                this.socketMessage.stcDeveloperMode();
                this.socketMessage.stcClearDevErrors();
            }

            payload = JSON.parse(payload);
            let account:any = Config.safeProperty(payload, ["account"], null);
            let data:any = Config.safeProperty(payload, ["data"], null);
            let network:any = Config.safeProperty(payload, ["network"], null);
            if (!account || !data || !network) {
                // We must specify an account, data, and network in the payload.
                this.socketMessage.stcDevMessage("[" + account.name + "] BAD PAYLOAD from IP " + this.socketMessage.getSocket().handshake.address);
                return;
            }

            // Validate the scatter signature
            let host:string = this.extractRootDomain(payload.data);
            if (this.eos().verifySignature(host, payload.publicKey, payload.sig)) {
                let timestamp:string = moment().format();
                console.log("[" + account.name + "] CONNECTED from IP " + this.socketMessage.getSocket().handshake.address + " at " + timestamp);

                // Save our network
                this.network = payload.network;

                // Send the account info structure to the client
                let referrer:string = Config.safeProperty(payload, ["referrer"], null);
                this.sendAccountInfo(account.name, referrer);
            } else {
                // TODO BAD SCATTER SIGNATURE
                this.socketMessage.stcDevMessage("[" + account.name + "] BAD SIGNATURE from IP " + this.socketMessage.getSocket().handshake.address);
            }
        });

        socket.on(SocketMessage.CTS_GET_ALL_AUCTIONS, (data:any) => {
            this.socketMessage.stcCurrentAuctions(this.auctionManager.getAuctions());
        });

        socket.on(SocketMessage.CTS_GET_WINNERS_LIST, (data:any) => {
            let recentWinners:any[] = this.auctionManager.getRecentWinners();
            this.socketMessage.stcSendPastWinners(recentWinners);
        });

        socket.on(SocketMessage.CTS_GET_DIVIDEND_INFO, (data:any) => {
            this.dividendManager.getDividendInfo().then((dividendInfo:any) => {
                this.socketMessage.stcDividendInfo(dividendInfo);
            });
        });

        socket.on(SocketMessage.CTS_GET_FAUCET_INFO, (data:any) => {
            if (this.accountInfo) {

                this.purgeFaucetCache();

                // Check the cache
                let faucetInfo:any = this.checkFaucetCache();
                if (faucetInfo) {
                    this.socketMessage.stcDevMessage("CTS_GET_FAUCET_INFO returning from cache!");
                    this.socketMessage.stcFaucetInfo(faucetInfo);
                    return;
                }

                // Hit the database
                this.dbManager.getDocumentByKey("users", {accountName: this.accountInfo.account_name}).then((user) => {
                    if (user) {
                        let faucetInfo: any = null;
                        if (user.lastFaucetTime) {
                            let deltaSecs: number = Math.floor(new Date().getTime() / 1000) - user.lastFaucetTime;
                            if (deltaSecs < Config.FAUCET_FREQUENCY_SECS) {
                                faucetInfo = {
                                    account: this.accountInfo.account_name,
                                    nextDrawSecs: Config.FAUCET_FREQUENCY_SECS - deltaSecs,
                                    drawEverySecs: Config.FAUCET_FREQUENCY_SECS
                                };
                                ClientConnection.faucetCache[this.accountInfo.account_name] = faucetInfo;
                            }
                        }
                        if (!faucetInfo) {
                            faucetInfo = {
                                account: this.accountInfo.account_name,
                                nextDrawSecs: 0,
                                drawEverySecs: Config.FAUCET_FREQUENCY_SECS
                            };
                        }
                        this.socketMessage.stcFaucetInfo(faucetInfo);
                    } else {
                        this.socketMessage.stcDevMessage("CTS_GET_FAUCET_INFO: Did not find user " + this.accountInfo.account_name + " in database");
                    }
                }).catch((err) => {
                    console.log(err);
                });

            } else {
                // TODO We should block the IP because this should not happen on our website
            }
        });

        socket.on(SocketMessage.CTS_FAUCET_DRAW, (data:any) => {
            if (this.accountInfo) {

                this.purgeFaucetCache();

                // Check the cache
                let faucetInfo:any = this.checkFaucetCache();
                if (faucetInfo) {
                    this.socketMessage.stcDevMessage("CTS_FAUCET_DRAW returning from cache!");
                    this.socketMessage.stcFaucetInfo(faucetInfo);
                    return;
                }

                this.dbManager.getDocumentByKey("users", {accountName: this.accountInfo.account_name}).then((user) => {
                    if (user) {
                        let faucetAward: any = null;
                        let now = Math.floor(new Date().getTime() / 1000);
                        if (user.lastFaucetTime) {
                            let deltaSecs: number = now - user.lastFaucetTime;
                            if (deltaSecs < Config.FAUCET_FREQUENCY_SECS) {
                                faucetAward = {
                                    account: this.accountInfo.account_name,
                                    nextDrawSecs: Config.FAUCET_FREQUENCY_SECS - deltaSecs,
                                    drawEverySecs: Config.FAUCET_FREQUENCY_SECS
                                };
                                this.socketMessage.stcFaucetAward(faucetAward);
                            }
                        }
                        if (!faucetAward) {

                            // We can award the faucet
                            let award: number;
                            let randomDraw: number = Math.floor(Math.random() * 10001);
                            if (randomDraw <= 9885) {
                                award = 0.0005;
                            } else if (randomDraw <= 9985) {
                                award = 0.005;
                            } else if (randomDraw <= 9993) {
                                award = 0.05;
                            } else if (randomDraw <= 9997) {
                                award = 0.5;
                            } else if (randomDraw <= 9999) {
                                award = 5;
                            } else {
                                award = 50;
                            }

                            // Create our faucet cache entry to eliminate the need to
                            // check the database on future requests (which should not
                            // happen from our website).
                            ClientConnection.faucetCache[this.accountInfo.account_name] = {
                                lastFaucetTime: now,
                                cacheHitTime: now,
                                cacheHits: 0
                            };

                            let currentFaucetAwards: number = Config.safeProperty(user, ["totalFaucetAwards"], 0);
                            let newFaucetAwards: number = currentFaucetAwards + award;
                            this.dbManager.updateDocumentByKey("users", {accountName: this.accountInfo.account_name}, {
                                lastFaucetTime: now,
                                totalFaucetAwards: newFaucetAwards
                            }).then((result) => {

                                // Pay the faucet recipient
                                this.eos().faucetPayout(this.accountInfo.account_name, award).then((result) => {
                                    faucetAward = {
                                        account: this.accountInfo.account_name,
                                        randomDraw: randomDraw,
                                        eosAward: award,
                                        totalEosAwards: newFaucetAwards,
                                        nextDrawSecs: Config.FAUCET_FREQUENCY_SECS
                                    };
                                    this.socketMessage.stcFaucetAward(faucetAward);
                                }).catch((reason) => {
                                    console.log(reason);
                                    this.socketMessage.stcDevMessage("Could not payout faucet award.");
                                });

                            });
                        }
                    } else {
                        this.socketMessage.stcDevMessage("CTS_FAUCET_DRAW: Did not find user " + this.accountInfo.account_name + " in database");
                    }
                }).catch((err) => {
                    console.log(err);
                });
            } else {
                // TODO We should block the IP because this should not happen on our website
            }
        })
    }

    /**
     * Checks our faucet cache to see if we are blocked from receiving a faucet award
     * @returns {any}
     */
    private checkFaucetCache() : any {

        let faucetInfo:any = null;
        if (ClientConnection.faucetCache.hasOwnProperty(this.accountInfo.account_name)) {
            let cacheEntry:any = ClientConnection.faucetCache[this.accountInfo.account_name];
            let deltaSecs:number = Math.floor(new Date().getTime()/1000) - cacheEntry.lastFaucetTime;
            if (deltaSecs < Config.FAUCET_FREQUENCY_SECS) {

                // Check, for abuse
                let now = Math.floor(new Date().getTime()/1000);
                let secsSinceLastCacheCheck:number = now - cacheEntry.cacheHitTime;
                if (secsSinceLastCacheCheck < 5) {
                    if (++cacheEntry.cacheHits > 3) {
                        // TODO block this IP because they are banging at the faucet
                        this.socketMessage.stcDevMessage("checkFaucetCache(): " + this.accountInfo.account_name + " is abusing the faucet");
                    }
                } else {
                    cacheEntry.cacheHits = 0;
                    cacheEntry.cacheHitTime = now;
                }

                // Return the faucet information
                faucetInfo = {
                    account: this.accountInfo.account_name,
                    nextDrawSecs: Config.FAUCET_FREQUENCY_SECS - deltaSecs,
                    drawEverySecs: Config.FAUCET_FREQUENCY_SECS
                };
            }
        }
        return faucetInfo;
    }

    /**
     * Purges the faucetCache of entries that are no longer in the waiting zone
     */
    private purgeFaucetCache():void {
        for (let key in ClientConnection.faucetCache) {
            let cacheEntry = ClientConnection.faucetCache[key];
            let deltaSecs:number = Math.floor(new Date().getTime()/1000) - cacheEntry.lastFaucetTime;
            if (deltaSecs >= Config.FAUCET_FREQUENCY_SECS) {
                this.socketMessage.stcDevMessage("Purged " + key + " from faucet cache");
                delete ClientConnection.faucetCache[key];
            }
        }
    }

    /**
     * Checks to see if the IP address is currently to be blocked
     * @param {string} ipAddress
     * @returns {boolean}
     */
    private isBlockedIPAddress(ipAddress:string):boolean {
        // TODO NEED TO CHECK IP AGAINST BLOCKED ONES
        return false;
    }

    private extractHostname(url:string) {
        let hostname:string;
        //find & remove protocol (http, ftp, etc.) and get hostname
        if (url.indexOf("//") > -1) {
            hostname = url.split('/')[2];
        }
        else {
            hostname = url.split('/')[0];
        }
        //find & remove port number
        hostname = hostname.split(':')[0];
        //find & remove "?"
        hostname = hostname.split('?')[0];
        return hostname;
    }

    private extractRootDomain(url:string) {
        var domain:string = this.extractHostname(url),
            splitArr = domain.split('.'),
            arrLen = splitArr.length;

        //extracting the root domain here
        //if there is a subdomain
        if (arrLen > 2) {
            domain = splitArr[arrLen - 2] + '.' + splitArr[arrLen - 1];
            //check to see if it's using a Country Code Top Level Domain (ccTLD) (i.e. ".me.uk")
            if (splitArr[arrLen - 2].length == 2 && splitArr[arrLen - 1].length == 2) {
                //this is using a ccTLD
                domain = splitArr[arrLen - 3] + '.' + domain;
            }
        }
        return domain;
    }

    /**
     * Registers an account in the database if it has not already been registered.
     *
     * @param accountInfo
     * @param {string} referrer
     * @returns {Promise<void>}
     */
    private registerClientAccount(accountInfo:any, referrer:string) : Promise<void> {
        return this.dbManager.getDocumentByKey("users", {accountName: accountInfo.account_name}).then((user) => {
            if (user) {
                // We have already seen this guy
                if (user.ipAddresses.indexOf(this.ipAddress) < 0) {
                    user.ipAddresses.push(this.ipAddress);
                }
                user.eosBalance = accountInfo.core_liquid_balance;
                user.timeBalance = accountInfo.timeBalance;
                user.lastConnectedTime = moment().format();
                accountInfo.referrer = user.referrer;
                return this.dbManager.updateDocumentByKey("users", {accountName: accountInfo.account_name}, user);
            } else {
                // This is a new user
                let user: any = {
                    accountName: accountInfo.account_name,
                    connectionCount: 1,
                    eosBalance: accountInfo.core_liquid_balance,
                    timeBalance: accountInfo.timeBalance,
                    lastFaucetTime: null,
                    lastConnectedTime: moment().format(),
                    ipAddresses: [this.ipAddress]
                };
                if (referrer) {
                    return this.dbManager.getDocumentByKey("users", {accountName: referrer}).then((referrer) => {
                       if (referrer && (referrer.accountName != accountInfo.account_name)) {
                           // Referrer exists in the database and is not user herself, so it's a go!
                           user.referrer = referrer.accountName;
                       }  else {
                           // Referrer did not exist in the database or referred himself - so we ignore!
                           user.referrer = null;
                       }
                       return this.dbManager.insertDocument("users", user);
                    });
                } else {
                    // No referrer passed in
                    user.referrer = null;
                    return this.dbManager.insertDocument("users", user);
                }
            }
        }).catch((err) => {
            console.log(err);
        });
    }

}