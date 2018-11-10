import {GUIManager} from "./GUIManager";
import {ViewStateObserver} from "./ViewStateObserver";
import {SocketMessage} from "../server/SocketMessage";
import {Moment} from "moment";
import {Config} from "./Config";

var moment = require('moment');

export class AuctionManager extends ViewStateObserver {

    private eos:any = null;
    private guiManager:GUIManager = null;
    private socketMessage:SocketMessage = null;
    private auctionElements:JQuery<HTMLElement>[] = null;

    private selectors:any = {
        "auctionInstancesLoading": ".auction-instances-loading",
        "auctionInstancesContainer": ".auction-instances-container",
        "auctionTemplate": ".auction-instance-template",
        "auctionInstance": ".auction-instance",
        "auctionInstanceBidder": ".auction-instance-bidder > span",
        "auctionInstancePrizePool": ".auction-instance-prize-pool > span",
        "auctionInstanceRemainingBids": ".auction-instance-remaining-bids > span",
        "auctionInstanceBidAmount": ".auction-instance-bid-amount",
        "auctionInstanceRemainingTime": ".auction-instance-remaining-time",
        "daysContainer": ".days-container",
        "formattedTimerString": ".formatted-timer-string",
        "auctionInstanceBidButton": ".auction-instance-bid-button",
        "animatedFlash": ".animated-flash",
        "auctionInstanceInnerContainer": ".auction-instance-inner-container",
        "auctionInstanceEnded": ".auction-instance-ended",
        "auctionInstanceId": ".auction-instance-id",
        "auctionInstanceBusy": ".auction-instance-busy"

    };

    /**
     * Constructs our Auction game manager
     */
    constructor(socketMessage:SocketMessage, guiManager:GUIManager) {
        super();
        this.socketMessage = socketMessage;
        this.guiManager = guiManager;

        // Interval to update our auction instances
        let localThis:AuctionManager = this;
        window.setInterval(() => {
            $(this.selectors.auctionInstance).each(function(i) {
                let $elem:any = $(this);
                localThis.updateRemainingTime(<JQuery<HTMLElement>>$elem);
            });
        }, 1000);

        this.attachSocketListeners();
    }

    /**
     * Listen for socket events sent from the back-end server
     */
    protected attachSocketListeners():void {
        this.socketMessage.getSocket().on(SocketMessage.STC_CURRENT_AUCTIONS, (data:any) => {
            data = JSON.parse(data);
            this.createAuctionElements(data.auctions);
        });
        this.socketMessage.getSocket().on(SocketMessage.STC_REMOVE_AUCTION, (auction:any) => {
            auction = JSON.parse(auction);
            let $auctionElementToRemove: JQuery<HTMLElement> = this.auctionElements.find(($elem:JQuery<HTMLElement>) => {
                let auctionToCheck:any = $elem.data("auction");
                return (auctionToCheck.id == auction.id);
            });
            if ($auctionElementToRemove) {
                $auctionElementToRemove.detach();
            }
        });

        this.socketMessage.getSocket().on(SocketMessage.STC_ADD_AUCTION, (auction:any) => {
            auction = JSON.parse(auction);
            this.insertNewAuctionElement(auction);
        });

        this.socketMessage.getSocket().on(SocketMessage.STC_CHANGE_AUCTION, (auction:any) => {
            auction = JSON.parse(auction);
            let $auctionElementToUpdate: JQuery<HTMLElement> = this.auctionElements.find(($elem:JQuery<HTMLElement>) => {
                let auctionToCheck:any = $elem.data("auction");
                return (auctionToCheck.type == auction.type);
            });
            if ($auctionElementToUpdate) {
                $auctionElementToUpdate.find(this.selectors.auctionInstanceBusy).addClass("d-none");
                $auctionElementToUpdate.data("auction", auction);
                this.updateAuctionElement($auctionElementToUpdate);
            }
        });

        this.socketMessage.getSocket().on(SocketMessage.STC_END_AUCTION, (auction:any) => {
            auction = JSON.parse(auction);
            let $auctionElementToUpdate: JQuery<HTMLElement> = this.auctionElements.find(($elem:JQuery<HTMLElement>) => {
                let auctionToCheck:any = $elem.data("auction");
                return (auctionToCheck.id == auction.id);
            });
            if ($auctionElementToUpdate) {
                let currentAuctionData:any = $auctionElementToUpdate.data("auction");
                let currentStatus:string = currentAuctionData.status;
                $auctionElementToUpdate.data("auction", auction);
                if (currentStatus != "ended") {
                    this.updateAuctionElement($auctionElementToUpdate, false);
                }
            }
        });
    }

    protected attachGUIHandlers():void {

        super.attachGUIHandlers();

        // Listen for a new eos blockchain object
        $(document).on("updateEos", (event) => {
            this.eos = event.detail;
            if (this.eos) {
                this.socketMessage.ctsGetAllAuctions();

                // this.eosLoadActiveAuctions().then((data) => {
                //
                //     let colsPerRow:number = parseInt($(this.selectors.auctionInstancesContainer).attr("data-cols-per-row"));
                //
                //     this.auctionElements = new Array<JQuery<HTMLElement>>();
                //     let idx:number = 0;
                //     let $row:JQuery<HTMLElement> = null;
                //     for (let auction of data) {
                //
                //         if ($row == null) {
                //             $row = $("<div />").addClass("row");
                //             $(this.selectors.auctionInstancesContainer).append($row);
                //         }
                //
                //         let $clone = $(this.selectors.auctionTemplate).clone()
                //             .removeClass("d-none")
                //             .removeClass(this.selectors.auctionTemplate.substr(1))
                //             .attr("id", "auction_id_" + auction.auction_id);
                //         $clone.data("auction", auction);
                //         this.auctionElements.push($clone);
                //         this.initializeAuctionElement($clone, auction);
                //         $row.append($clone);
                //
                //         idx++;
                //         if (idx == colsPerRow) {
                //             $(this.selectors.auctionInstancesContainer).append($row);
                //             $row = null;
                //         }
                //     }
                //     $(this.selectors.auctionInstancesContainer).removeClass("d-none");
                //     $(this.selectors.auctionInstancesLoading).addClass("d-none");
                // }).catch((err) => {
                //     // TODO Reflect error to user in GUI somehow
                //     console.log("Error loading auctions from blockchain");
                //     console.log(err);
                // });
            }
        });
    }

    protected socketConnected():void {
        super.socketConnected();
    }

    // ========================================================================
    // PRIVATE METHODS
    // ========================================================================

    /**
     * Inserts a new auction into the DOM
     * @param auction
     */
    private insertNewAuctionElement(auction:any):void {
        let $clone = $(this.selectors.auctionTemplate).clone()
            .removeClass("d-none")
            .removeClass(this.selectors.auctionTemplate.substr(1))
            .attr("id", "auction_id_" + auction.id);
        $clone.data("auction", auction);
        this.auctionElements.push($clone);
        this.auctionElements.sort((a:any, b:any):number => {
            const aa:any = a.data("auction");
            const ba:any = b.data("auction");
            const af:number = parseFloat(aa.bid_price);
            const bf:number = parseFloat(ba.bid_price);
            if (af > bf) {
                return -1;
            } else if (af < bf) {
                return 1;
            } else {
                return 0;
            }
        });
        this.initializeAuctionElement($clone, auction);

        let didInsert:boolean = false;
        $(this.selectors.auctionInstancesContainer).children().each(function(idx:number) {
            const $child:JQuery<HTMLElement> = $(this);
            const existingAuction:any = $child.data("auction");
            const newBidPrice:number = parseFloat(auction.bid_price);
            const existingBidPrice:number = parseFloat(existingAuction.bid_price);
            if (newBidPrice > existingBidPrice) {
                $clone.insertBefore($child);
                didInsert = true;
                return false;
            }
        });
        if (!didInsert) {
            $(this.selectors.auctionInstancesContainer).append($clone);
        }
    }

    /**
     * Creates our initial auction GUI elements
     * @param {any[]} auctions
     */
    private createAuctionElements(auctions:any[]):void {
        auctions.sort((a:any, b:any):number => {
            const af:number = parseFloat(a.bid_price);
            const bf:number = parseFloat(b.bid_price);
            if (af > bf) {
                return -1;
            } else if (af < bf) {
                return 1;
            } else {
                return 0;
            }
        });
        this.auctionElements = new Array<JQuery<HTMLElement>>();
        for (let auction of auctions) {
            let $clone = $(this.selectors.auctionTemplate).clone()
                .removeClass("d-none")
                .removeClass(this.selectors.auctionTemplate.substr(1))
                .attr("id", "auction_id_" + auction.id);
            $clone.data("auction", auction);
            this.auctionElements.push($clone);
            this.initializeAuctionElement($clone, auction);
            $(this.selectors.auctionInstancesContainer).append($clone);
        }
        $(this.selectors.auctionInstancesContainer).removeClass("d-none");
        $(this.selectors.auctionInstancesLoading).addClass("d-none");
    }

    /**
     * Initializes an auction GUI element from an auction data structure
     * @param {JQuery<HTMLElement>} $elem
     * @param auction
     */
    private initializeAuctionElement($elem:JQuery<HTMLElement>, auction: any): void {
        $elem.find(this.selectors.auctionInstanceId).text(auction.id.toString());
        $elem.find(this.selectors.auctionInstanceBidder).text(auction.last_bidder);
        $elem.find(this.selectors.auctionInstancePrizePool).text(auction.prize_pool);
        $elem.find(this.selectors.auctionInstanceRemainingBids).text(auction.remaining_bid_count);
        $elem.find(this.selectors.auctionInstanceBidAmount).text(auction.bid_price);
        $elem.data("lastUpdateTime", Math.floor(new Date().getTime()/1000));
        if (auction.status == "ended") {
            $elem.find(this.selectors.auctionInstanceBidButton).addClass("d-none");
            $elem.find(this.selectors.auctionInstanceEnded).removeClass("d-none");
        } else {
            $elem.find(this.selectors.auctionInstanceBidButton).removeClass("d-none");
            $elem.find(this.selectors.auctionInstanceEnded).addClass("d-none");
        }
        this.updateRemainingTime($elem);
        $elem.find(this.selectors.auctionInstanceBidButton).on("click", (event) => {
            let $auctionElement:JQuery<HTMLElement> = $(event.currentTarget).closest(this.selectors.auctionInstance);
            this.eosBid($auctionElement).then((result) => {

                // TODO Some sort of winning animation if this bid resulted in winning the jackpot

                // TODO Temporary, we really update the GUI only on message coming back from server and don't deal with the promise
                let auction:any = $auctionElement.data("auction");
                auction.remaining_bid_count = result.remaining_bid_count;
                auction.last_bidder = result.last_bidder;
                auction.prize_pool = result.prize_pool;
                auction.expires = result.expires;
                this.updateAuctionElement($auctionElement);
            });
        });
    }

    /**
     * Updates an existing auction GUI element (flashing the changed fields)
     * @param {JQuery<HTMLElement>} $elem
     */
    private updateAuctionElement($elem:JQuery<HTMLElement>, flash:boolean = true): void {

        let auction:any = $elem.data("auction");
        $elem.data("lastUpdateTime", Math.floor(new Date().getTime()/1000));
        this.updateRemainingTime($elem);
        $elem.find(this.selectors.auctionInstanceId).text(auction.id.toString());
        $elem.find(this.selectors.auctionInstanceRemainingBids).text(auction.remaining_bid_count);
        $elem.find(this.selectors.auctionInstanceBidder).text(auction.last_bidder);
        $elem.find(this.selectors.auctionInstancePrizePool).text(auction.prize_pool);
        if (auction.status == "ended") {
            $elem.find(this.selectors.auctionInstanceBidButton).addClass("d-none");
            $elem.find(this.selectors.auctionInstanceEnded).removeClass("d-none");
        } else {
            $elem.find(this.selectors.auctionInstanceBidButton).removeClass("d-none");
            $elem.find(this.selectors.auctionInstanceEnded).addClass("d-none");
        }

        if (auction.status == "ended") {
            $elem.find(this.selectors.auctionInstanceBidButton).addClass("d-none");
            $elem.find(this.selectors.auctionInstanceEnded).removeClass("d-none");
        }

        if (flash) {
            // Flash our field elements
            let $elementsToFlash: JQuery<HTMLElement>[] = [
                $elem.find(this.selectors.auctionInstancePrizePool),
                $elem.find(this.selectors.auctionInstanceRemainingBids),
                $elem.find(this.selectors.formattedTimerString),
                $elem.find(this.selectors.auctionInstanceBidder)
            ];
            for (let $elemToFlash of $elementsToFlash) {
                $elemToFlash.removeClass("flash");
                setTimeout(() => {
                    for (let $elemToFlash of $elementsToFlash) {
                        $elemToFlash.addClass("flash");
                    }
                }, 10);
            }

            // Flash our border
            $elem.find(this.selectors.auctionInstanceInnerContainer).removeClass("flash-border");
            setTimeout(() => {
                $elem.find(this.selectors.auctionInstanceInnerContainer).addClass("flash-border");
            }, 10);
        }
    }

    /**
     * Updates the remaining time on the specified auction GUI element
     * @param {JQuery<HTMLElement>} $elem
     * @param auction
     */
    private updateRemainingTime($elem:JQuery<HTMLElement>): void {
        let auction:any = $elem.data("auction");
        if (auction) {
            let lastUpdateTime:number = <number> $elem.data("lastUpdateTime");
            let clientTime:number = Math.floor(new Date().getTime()/1000);
            let secsSinceLastUpdate:number = clientTime - lastUpdateTime;
            let now: number = auction.block_time + secsSinceLastUpdate;
            let remainingSecs: number = auction.expires - now;
            if (remainingSecs < 0) {
                remainingSecs = 0;
            }
            let days: number = Math.floor(remainingSecs / 86400);
            if (!isNaN(days)) {
                if (days > 0) {
                    $elem.find(this.selectors.daysContainer).removeClass("d-none");
                    if (days > 1) {
                        $elem.find(this.selectors.daysContainer).text(days.toString() + " days");
                    } else {
                        $elem.find(this.selectors.daysContainer).text(days.toString() + " day");
                    }
                } else {
                    $elem.find(this.selectors.daysContainer).addClass("d-none");
                }
            } else {
                $elem.find(this.selectors.daysContainer).addClass("d-none");
            }

            remainingSecs -= 86400 * days;
            let hours: number = Math.floor(remainingSecs / 3600);
            remainingSecs -= 3600 * hours;
            let minutes: number = Math.floor(remainingSecs / 60);
            remainingSecs -= 60 * minutes;
            remainingSecs = Math.floor(remainingSecs);

            $elem.find(this.selectors.formattedTimerString).html("");
            if (!isNaN(hours) && !isNaN(minutes) && !isNaN(remainingSecs)) {
                let hoursStr: string = hours.toString().length == 1 ? "0" + hours.toString() : hours.toString();
                let minsStr: string = minutes.toString().length == 1 ? "0" + minutes.toString() : minutes.toString();
                let secsStr: string = remainingSecs.toString().length == 1 ? "0" + remainingSecs.toString() : remainingSecs.toString();
                let formatedRemaining: string = hoursStr + "<span style='font-size:75%' class='grey-text'>h </span>" + minsStr + "<span style='font-size:75%' class='grey-text'>m </span>" + secsStr + "<span style='font-size:75%' class='grey-text'>s</span>";
                $elem.find(this.selectors.formattedTimerString).html(formatedRemaining);
            }
        }
    };

    // ========================================================================
    // BLOCKCHAIN API METHODS
    // ========================================================================

    /**
     * Places a bid on the blockchain
     * @param {JQuery<HTMLElement>} $auctionElement
     * @returns {Promise<any>}
     */
    private eosBid($auctionElement:JQuery<HTMLElement>):Promise<any> {
        return new Promise<any>((resolve, reject) => {
            if (this.eos) {

                let auction:any = $auctionElement.data("auction");

                const urlParams:any = new URLSearchParams(window.location.search);
                const referrer:string = urlParams.get('ref');

                const options = {authorization: [`${this.account.name}@${this.account.authority}`]};
                const assetAndQuantity:string = auction.bid_price + " EOS";
                let memo:string = "RZBID-" + auction.id;
                if (referrer) {
                    memo += "-" + referrer;
                }
                try {
                    $auctionElement.find(this.selectors.auctionInstanceBusy).removeClass("d-none");
                    this.eos.transfer(this.account.name, Config.eostimeContract, assetAndQuantity, memo, options).then((result) => {
                        console.log(result);
                    }).catch(err => {
                        $auctionElement.find(this.selectors.auctionInstanceBusy).addClass("d-none");
                        let error = Config.safeProperty(err, ["error"], null);
                        if (error) {
                            console.log("======");
                            let errorMessages: string[] = Config.safeProperty(error, ["details"], null);
                            if (errorMessages) {
                                for (let errorMessage of errorMessages) {
                                    console.log(errorMessage);
                                }
                            }
                        }
                        let errorMessage: string = Config.safeProperty(err, ["message"], null);
                        if (errorMessage) {
                            console.log(errorMessage);
                        } else {
                            console.log(err);
                        }
                    });
                } catch (err) {
                    alert("Here");
                    console.log("Caught error");
                    console.log(err);
                }

            } else {
                reject(new Error("No eos object available"));
            }
        });
    }

    /**
     * Loads all active auctions from the blockchain
     * @returns {Promise<any[]>}
     */
    /*
    private eosLoadActiveAuctions():Promise<any[]> {

        // Remove any existing auctions and display the loading GUI element
        this.auctionElements = null;
        $(this.selectors.auctionInstancesContainer).empty().addClass("d-none");
        $(this.selectors.auctionInstancesLoading).removeClass("d-none");

        // TODO HIT THE ACTUAL AUCTION CONTRACT
        return new Promise<any>((resolve, reject) => {
            if (this.eos) {

                // TODO THIS IS BOGUS - USING A CONTRACT GREG IS DEVELOPING
                this.eos.getTableRows(
                    {
                        code: Config.eostimeContract,
                        scope: Config.eostimeContract,
                        table: Config.eostimeContractAuctionTable,
                        json: true,
                    }
                ).then(function (data) {

                    let auctions:any[] = Config.safeProperty(data, ["rows"], null);
                    if (auctions) {
                        // data.rows[n] from blockchain table:
                        //
                        // auto_refill: 0
                        // bid_price: "0.1000 EOS"
                        // creation_time: "2018-11-07T13:59:54"
                        // enabled: 1
                        // expires: "2018-11-07T14:58:12"
                        // id: 1
                        // init_bid_count: 250
                        // init_duration_secs: 30
                        // init_prize_pool: "10.0000 EOS"
                        // init_redzone_secs: 15
                        // instance_id: 128
                        // last_bidder: "eostimecontr"
                        // prize_pool: "10.0000 EOS"
                        // remaining_bid_count: 250

                        // Massage the data from the blockchain a little bit
                        for (let auction of auctions) {
                            console.log(auction.expires);
                            auction.prize_pool = auction.prize_pool.split(" ")[0];
                            auction.bid_price = auction.bid_price.split(" ")[0];
                            auction.expires = parseInt(moment(auction.expires + "+00:00").local().format("X"));
                            auction.creation_time = parseInt(moment(auction.creation_time + "+00:00").local().format("X"));
                        }
                    }

                    // let spoofData:any[] = [
                    //     {
                    //         "auction_id": 223,
                    //         "creation_time": Math.floor(new Date().getTime()/1000) - 20000 - Math.floor(66400 * Math.random()),
                    //         "prize_pool": "12.5000",
                    //         "bid_price": "0.0500",
                    //         "last_bidder": "chassettny11",
                    //         "last_bid_id": 112,
                    //         "expires": Math.floor(new Date().getTime()/1000) + Math.floor(Math.random()*180),
                    //         "remaining_bid_count": 20202
                    //     },
                    //     {
                    //         "auction_id": 224,
                    //         "creation_time": Math.floor(new Date().getTime()/1000) - 20000 - Math.floor(66400 * Math.random()),
                    //         "prize_pool": "20.0000",
                    //         "bid_price": "0.5000",
                    //         "last_bidder": "roscoebar101",
                    //         "last_bid_id": 334,
                    //         "expires": Math.floor(new Date().getTime()/1000) + Math.floor(Math.random()*180),
                    //         "remaining_bid_count": 10990
                    //     },
                    //     {
                    //         "auction_id": 225,
                    //         "creation_time": Math.floor(new Date().getTime()/1000) - 20000 - Math.floor(66400 * Math.random()),
                    //         "prize_pool": "40.0000",
                    //         "bid_price": "1.0000",
                    //         "last_bidder": "patchpage101",
                    //         "last_bid_id": 223,
                    //         "expires": Math.floor(new Date().getTime()/1000) + Math.floor(Math.random()*180),
                    //         "remaining_bid_count": 865
                    //     }
                    // ];

                    resolve(auctions);
                });
            } else {
                reject(new Error("No eos object available"));
            }

        });
    }
    */
}