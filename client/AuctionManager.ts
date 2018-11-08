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
        "auctionInstanceInnerContainer": ".auction-instance-inner-container"

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
    }

    protected attachGUIHandlers():void {

        super.attachGUIHandlers();

        // Listen for a new eos blockchain object
        $(document).on("updateEos", (event) => {
            this.eos = event.detail;
            if (this.eos) {
                this.eosLoadActiveAuctions().then((data) => {

                    let colsPerRow:number = parseInt($(this.selectors.auctionInstancesContainer).attr("data-cols-per-row"));

                    this.auctionElements = new Array<JQuery<HTMLElement>>();
                    let idx:number = 0;
                    let $row:JQuery<HTMLElement> = null;
                    for (let auction of data) {

                        if ($row == null) {
                            $row = $("<div />").addClass("row");
                            $(this.selectors.auctionInstancesContainer).append($row);
                        }

                        let $clone = $(this.selectors.auctionTemplate).clone()
                            .removeClass("d-none")
                            .removeClass(this.selectors.auctionTemplate.substr(1))
                            .attr("id", "auction_id_" + auction.auction_id);
                        $clone.data("auction", auction);
                        this.auctionElements.push($clone);
                        this.initializeAuctionElement($clone, auction);
                        $row.append($clone);

                        idx++;
                        if (idx == colsPerRow) {
                            $(this.selectors.auctionInstancesContainer).append($row);
                            $row = null;
                        }
                    }
                    $(this.selectors.auctionInstancesContainer).removeClass("d-none");
                    $(this.selectors.auctionInstancesLoading).addClass("d-none");
                }).catch((err) => {
                    // TODO Reflect error to user in GUI somehow
                    console.log("Error loading auctions from blockchain");
                    console.log(err);
                });
            }
        });

        // Listen for an auctionBid from the server and update the GUI
        $(document).on("auctionBid", (event) => {
            let auctionData:any = event.detail;
            if (this.auctionElements) {
                let $auctionElementToUpdate: JQuery<HTMLElement> = this.auctionElements.find(($elem:JQuery<HTMLElement>) => {
                    let auction:any = $auctionElementToUpdate.data("auction");
                    return (auction.auction_id == auctionData.auction_id);
                });

                // Update our auction GUI element
                if ($auctionElementToUpdate) {
                    $auctionElementToUpdate.data("auction", auctionData);
                    this.updateAuctionElement($auctionElementToUpdate);
                }
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
     * Initializes an auction GUI element from an auction data structure
     * @param {JQuery<HTMLElement>} $elem
     * @param auction
     */
    private initializeAuctionElement($elem:JQuery<HTMLElement>, auction: any): void {
        $elem.find(this.selectors.auctionInstanceBidder).text(auction.last_bidder);
        $elem.find(this.selectors.auctionInstancePrizePool).text(auction.prize_pool);
        $elem.find(this.selectors.auctionInstanceRemainingBids).text(auction.remaining_bid_count);
        $elem.find(this.selectors.auctionInstanceBidAmount).text(auction.bid_price);
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
    private updateAuctionElement($elem:JQuery<HTMLElement>): void {

        let auction:any = $elem.data("auction");
        this.updateRemainingTime($elem);
        $elem.find(this.selectors.auctionInstanceRemainingBids).text(auction.remaining_bid_count);
        $elem.find(this.selectors.auctionInstanceBidder).text(auction.last_bidder);
        $elem.find(this.selectors.auctionInstancePrizePool).text(auction.prize_pool);

        // Flash our field elements
        let $elementsToFlash:JQuery<HTMLElement>[] = [
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

    /**
     * Updates the remaining time on the specified auction GUI element
     * @param {JQuery<HTMLElement>} $elem
     * @param auction
     */
    private updateRemainingTime($elem:JQuery<HTMLElement>): void {
        let auction:any = $elem.data("auction");
        if (auction) {
            let now: number = Math.floor(new Date().getTime() / 1000);
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

    // todo get rid of this spoofing
    private spoofedBidders:string[] = ["chassettny11", "littlebilly1", "kramertheman"];
    private spoofedBidderIdx:number = 1;

    /**
     * Places a bid on the blockchain
     * @param {JQuery<HTMLElement>} $auctionElement
     * @returns {Promise<any>}
     */
    private eosBid($auctionElement:JQuery<HTMLElement>):Promise<any> {
        return new Promise<any>((resolve, reject) => {
            if (this.eos) {

                let auction:any = $auctionElement.data("auction");

                // TODO Transfer EOS to the blockchain contract
                const contractAccount: string = "ghassett1111";
                const assetAndQuantity: string = auction.bid_price;
                const auctionMemo: string = "bid-" + auction.auction_id;
                const options = {authorization: [`${this.account.name}@${this.account.authority}`]};

                this.eos.transfer(this.account.name, Config.eostimeContract, auction.bid_price + " EOS", auction.id + "-" + auction.instance_id, options).then((result) => {
                    console.log(result);
                }).catch(err => {

                    let error = Config.safeProperty(err, ["error"], null);
                    if (error) {
                        console.log("======");
                        let errorMessages:string[] = Config.safeProperty(error, ["details"], null);
                        if (errorMessages) {
                            for (let errorMessage of errorMessages) {
                                console.log(errorMessage);
                            }
                        }
                    }
                    let errorMessage:string = Config.safeProperty(err, ["message"], null);
                    if (errorMessage) {
                        console.log(errorMessage);
                    } else {
                        console.log(err);
                    }
                });

                // TODO Get rid of this spoofing
                // let bidders:string[] = ["chassettny11", "littlebilly1", "kramertheman", "pagepatchdog"];
                // let spoofedResult:any = {...auction};
                // spoofedResult.expires = auction.expires + 30;
                // spoofedResult.prize_pool = (parseFloat(auction.prize_pool) + parseFloat(spoofedResult.bid_price)).toFixed(4);
                // spoofedResult.last_bidder = this.spoofedBidders[this.spoofedBidderIdx++];
                // spoofedResult.remaining_bid_count--;
                // if (this.spoofedBidderIdx == this.spoofedBidders.length) this.spoofedBidderIdx = 0;
                // resolve(spoofedResult);

            } else {
                reject(new Error("No eos object available"));
            }
        });
    }

    /**
     * Loads all active auctions from the blockchain
     * @returns {Promise<any[]>}
     */
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

                        // Massage the data a little bit
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



}