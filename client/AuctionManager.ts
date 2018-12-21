import {Confetti, GUIManager} from "./GUIManager";
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
    private confetti:Confetti = null;
    private referrer:string = null;
    private currentLanguage:string = null;
    private eosNetwork:string = "mainnet";

    private selectors:any = {
        "mainAuctionArea": ".main-auction-area",
        "auctionInstancesLoading": ".auction-instances-loading",
        "auctionInstancesContainer": ".auction-instances-container",
        "auctionTemplate": ".auction-instance-template",
        "auctionInstance": ".auction-instance",
        "auctionInstanceBidderOuter": ".auction-instance-bidder",
        "auctionInstanceBidder": ".auction-instance-bidder > span",
        "auctionInstanceNoBidder": ".auction-instance-bidder-no-bidders",
        "auctionInstancePrizePool": ".auction-instance-prize-pool span:nth-child(2)",
        "auctionInstanceRemainingBids": ".auction-instance-remaining-bids > span",
        "auctionInstanceBidAmount": ".auction-instance-bid-amount",
        "auctionInstanceRemainingTime": ".auction-instance-remaining-time",
        "auctionInstanceDays": ".auction-instance-days",
        "auctionInstanceHours": ".auction-instance-hours",
        "auctionInstanceMinutes": ".auction-instance-minutes",
        "auctionInstanceSeconds": ".auction-instance-seconds",
        "daysContainer": ".days-container",
        "formattedTimerString": ".formatted-timer-string",
        "auctionInstanceBidButton": ".auction-instance-bid-button",
        "auctionInstanceLoginButton": ".auction-instance-login-button",
        "animatedFlash": ".animated-flash",
        "auctionInstanceInnerContainer": ".auction-instance-inner-container",
        "auctionInstanceEnded": ".auction-instance-ended",
        "auctionInstanceId": ".auction-instance-id",
        "auctionInstanceBusy": ".auction-instance-busy",
        "auctionWinners": ".auction-winners",
        "auctionWinnersInner": ".auction-winners-inner",
        "auctionWinnerInstanceTemplate": ".auction-winner-instance-template",
        "auctionWinnerInstanceTime": ".auction-winner-time",
        "auctionWinnerInstanceName": ".auction-winner-name",
        "auctionWinnerInstanceId": ".auction-winner-id",
        "auctionWinnerInstanceIdLink": ".auction-winner-id-link",
        "auctionWinnerInstanceDuration": ".auction-winner-duration",
        "auctionWinnerInstanceAmount": ".auction-winner-amount span:nth-child(2)",
        "ribbonContainer": ".ribbon-container"
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

        /**
         * Automatically sent by server upon connecting
         */
        this.socketMessage.getSocket().on(SocketMessage.STC_PAST_WINNERS, (data:any) => {
            data = JSON.parse(data);
            this.initializeWinnersBoard(data.winners);
        });

        /**
         * Client asks for these by sending a CTS_GET_ALL_AUCTIONS message
         */
        this.socketMessage.getSocket().on(SocketMessage.STC_CURRENT_AUCTIONS, (data:any) => {
            data = JSON.parse(data);
            this.guiManager.blockUI(false);
            this.createAuctionElements(data.auctions);
        });

        this.socketMessage.getSocket().on(SocketMessage.STC_AUCTION_UPDATE, (data:any) => {
            data = JSON.parse(data);
            let selector:string = ".external-transaction-link-" + data.auctionId;
            $(selector).removeClass("d-none");
            $(selector).find("a").attr("href", Config.TX_INFO_LINK_PREFIX[this.eosNetwork] + data.transactionId);
            (<any> $(selector)).animateCss('bounceIn');
        });

        this.socketMessage.getSocket().on(SocketMessage.STC_REMOVE_AUCTION, (auction:any) => {
            auction = JSON.parse(auction);
            console.log("Remove auction");
            console.log(auction);
            console.log("====================");

            // Removes all elements of the type specified by the auction parameter
            for (let i:number = 0; i < this.auctionElements.length; i++) {
                let $elem:JQuery<HTMLElement> = this.auctionElements[i];
                let auctionToCheck:any = $elem.data("auction");
                if (auctionToCheck.type == auction.type) {
                    this.auctionElements.splice(i, 1);
                    $elem.detach();
                }
            }
        });

        this.socketMessage.getSocket().on(SocketMessage.STC_ADD_AUCTION, (auction:any) => {
            auction = JSON.parse(auction);
            console.log("Add auction");
            console.log(auction);
            console.log("====================");
            this.insertNewAuctionElement(auction);
        });

        this.socketMessage.getSocket().on(SocketMessage.STC_CHANGE_AUCTION, (auction:any) => {
            auction = JSON.parse(auction);
            console.log("Change auction");
            console.log(auction);
            console.log("====================");
            let $auctionElementToUpdate: JQuery<HTMLElement> = this.auctionElements.find(($elem:JQuery<HTMLElement>) => {
                let auctionToCheck:any = $elem.data("auction");
                return (auctionToCheck.type == auction.type);
            });
            if ($auctionElementToUpdate) {
                $auctionElementToUpdate.find(this.selectors.auctionInstanceBusy).addClass("d-none");
                $auctionElementToUpdate.data("auction", auction);
                this.updateAuctionElement($auctionElementToUpdate);
            }
            if (this.accountInfo && auction.last_bidder == this.accountInfo.account_name) {
                let evt:CustomEvent = new CustomEvent("updateCoinBalances", {});
                document.dispatchEvent(evt);
                $auctionElementToUpdate.find(".auction-instance-bid-button").blur();
            }
        });

        this.socketMessage.getSocket().on(SocketMessage.STC_END_AUCTION, (auction:any) => {
            auction = JSON.parse(auction);
            console.log("End auction");
            console.log(auction);
            console.log("====================");
            let $auctionElementToUpdate: JQuery<HTMLElement> = this.auctionElements.find(($elem:JQuery<HTMLElement>) => {
                let auctionToCheck:any = $elem.data("auction");
                return (auctionToCheck.type == auction.type);
            });
            if ($auctionElementToUpdate) {
                let currentAuctionData:any = $auctionElementToUpdate.data("auction");
                let currentAuctionLastBidder:string = currentAuctionData.last_bidder;
                let currentStatus:string = currentAuctionData.status;
                $auctionElementToUpdate.data("auction", auction);
                if (currentStatus != "ended") {
                    this.updateAuctionElement($auctionElementToUpdate, false);
                }
            }

            (<any> $auctionElementToUpdate).animateCss('bounceIn');
        });

        this.socketMessage.getSocket().on(SocketMessage.STC_WINNER_AUCTION, (auction:any) => {
            auction = JSON.parse(auction);
            console.log("Winner auction");
            console.log(auction);
            console.log("====================");
            this.addWinnerToLeaderBoard(auction);
            if (this.accountInfo && auction.last_bidder == this.accountInfo.account_name) {
                setTimeout(() => {
                    let evt:CustomEvent = new CustomEvent("updateCoinBalances", {});
                    document.dispatchEvent(evt);
                }, 3000);
            }
        });
    }

    /**
     * Attach listeners for the GUI messages
     */
    protected attachGUIHandlers():void {

        super.attachGUIHandlers();

        // Listen for new socketMessage
        $(document).on("updateSocketMessage", (event) => {
            this.socketMessage = <any> event.detail;
            this.attachSocketListeners();
        });

        // Network change
        $(document).on("updateEosNetwork", (event) => {
            this.eosNetwork = <any> event.detail;
        });

        $(document).on("initializeGameGUI", (event) => {
            this.socketMessage.ctsGetAllAuctions();
            this.socketMessage.ctsGetWinnersList();
        });

        // Listen for a new eos blockchain object
        $(document).on("updateEos", (event) => {
            this.eos = event.detail;
            if (this.eos) {
                this.socketMessage.ctsGetAllAuctions();
            }
        });

        $(document).on("setReferrer", (event) => {
            let referrer:any = event.detail;
            this.referrer = <string> referrer;
        });

        $(document).on("currentLanguage", (event) => {

            let language:any = event.detail;
            this.currentLanguage = language;

            // Fix auctions
            let localThis:AuctionManager = this;
            $(this.selectors.auctionInstancesContainer).children().each(function (idx:number) {
                const $elem:JQuery<HTMLElement> = $(this);
                const auction:any = $elem.data("auction");
                $elem.find(localThis.selectors.auctionInstanceBidderOuter).addClass("d-none");
                $elem.find(localThis.selectors.auctionInstanceNoBidder).addClass("d-none");
                if (auction.last_bidder == Config.EOSTIME_CONTRACT) {
                    $elem.find(localThis.selectors.auctionInstanceNoBidder + "." + localThis.currentLanguage).removeClass("d-none");
                } else {
                    $elem.find(localThis.selectors.auctionInstanceBidderOuter).removeClass("d-none");
                }
            });
        });
    }

    protected socketConnected():void {
        super.socketConnected();
    }

    protected setLoggedInView(account:any, accountInfo:any):void {
        super.setLoggedInView(account, accountInfo);
        let localThis:AuctionManager = this;
        $(this.selectors.auctionInstancesContainer).children().each(function (idx:number) {
            const $elem:JQuery<HTMLElement> = $(this);
            const auction:any = $elem.data("auction");
            localThis.updateAuctionElementButtonState($elem, auction);
        });
    }

    protected setLoggedOutView():void {
        super.setLoggedOutView();
        let localThis:AuctionManager = this;
        $(this.selectors.auctionInstancesContainer).children().each(function (idx:number) {
            const $elem:JQuery<HTMLElement> = $(this);
            const auction:any = $elem.data("auction");
            localThis.updateAuctionElementButtonState($elem, auction);
        });
    }

    // ========================================================================
    // PRIVATE METHODS
    // ========================================================================

    private initializeWinnersBoard(winners:any[]):void {
        $(this.selectors.auctionWinnersInner).empty();
        for (let i:number = winners.length - 1; i >= 0; i--) {
            let auction:any = winners[i];
            this.addWinnerToLeaderBoard(auction, false);
        }
    }

    private addWinnerToLeaderBoard(auction:any, playAnimation:boolean = true):void {

        /* An auction structure looks like this:
        *  {
        *      bid_multiplier_x100k: 105000
        *      bid_price: "0.0300"
        *      bidder_timecoins_per_eos: 50
        *      block_time: 1542635132
        *      creation_time: 1542635122
        *      enabled: 1
        *      expires: 1542635152
        *      house_portion_x100k: 9625
        *      id: 11659
        *      init_bid_count: 25
        *      init_bid_price: "0.0300 EOS"
        *      init_duration_secs: 30
        *      init_prize_pool: "0.2500 EOS"
        *      init_redzone_secs: 15
        *      last_bidder: "eostimecontr"
        *      paid_out: 0
        *      prize_pool: "0.2500"
        *      referrer_portion_x100k: 375
        *      remaining_bid_count: 25
        *      status: "active"
        *      type: 1000
        *      winner_timecoins_per_eos: 10,
        *      blockNumber: <optional>,
        *      transactionId: <optional>
        *  }
        */

        let start:Moment = moment.unix(auction.creation_time);
        let end:Moment = moment.unix(auction.expires);
        let diff:number = end.diff(start);
        let duration:string = moment.utc(diff).format("HH:mm:ss.SSS");

        let $clone:JQuery<HTMLElement> = $(this.selectors.auctionWinnerInstanceTemplate).clone().removeClass(this.selectors.auctionWinnerInstanceTemplate.substr(1)).removeClass("d-none");
        $clone.find(this.selectors.auctionWinnerInstanceId).text(auction.type + "-" + auction.id);
        $clone.find(this.selectors.auctionWinnerInstanceName).text(auction.last_bidder);
        $clone.find(this.selectors.auctionWinnerInstanceAmount).text(auction.prize_pool);
        $clone.find(this.selectors.auctionWinnerInstanceDuration).text(duration);
        $clone.find(this.selectors.auctionWinnerInstanceTime).text(end.format("h:mm a"));
        $(this.selectors.auctionWinnersInner).prepend($clone);

        let blockNumber:number = Config.safeProperty(auction, ["blockNumber"], null);
        let transactionId:number = Config.safeProperty(auction, ["transactionId"], null);
        if (blockNumber && transactionId) {
            $clone.find(this.selectors.auctionWinnerInstanceIdLink).removeClass("d-none");
            $clone.find(this.selectors.auctionWinnerInstanceIdLink).find("a").attr("href", Config.TX_INFO_LINK_PREFIX[this.eosNetwork] + transactionId);
        }
        $clone.find(this.selectors.auctionWinnerInstanceIdLink).addClass("external-transaction-link-" + auction.id);

        // Show confetti animation if we aren't currently running one
        if (playAnimation) {
            if (this.confetti === null) {
                this.confetti = new Confetti($(this.selectors.auctionWinners)[0]);
                this.confetti.startConfetti();
                setTimeout(() => {
                    this.confetti.stopConfetti();
                    setTimeout(() => {
                        this.confetti.removeConfetti();
                        this.confetti = null;
                    }, 1500);
                }, 1000);
            }
        }

        // If there are more than the max in the winner board, purge
        // the oldest one.
        if ($(this.selectors.auctionWinnersInner).children().length > Config.MAX_WINNERS_IN_GUI) {
            $(this.selectors.auctionWinnersInner).children().last().remove();
        }
    }

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
            const af:number = parseFloat(aa.type);
            const bf:number = parseFloat(ba.type);
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
            const af:number = parseFloat(a.type);
            const bf:number = parseFloat(b.type);
            if (af > bf) {
                return -1;
            } else if (af < bf) {
                return 1;
            } else {
                return 0;
            }
        });
        $(this.selectors.auctionInstancesContainer).empty();
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
        $(this.selectors.mainAuctionArea).removeClass("d-none");
        $(this.selectors.auctionInstancesLoading).addClass("d-none");
    }

    /**
     * Update the button state on a particular auction element
     * @param {JQuery<HTMLElement>} $elem
     * @param auction
     */
    private updateAuctionElementButtonState($elem:JQuery<HTMLElement>, auction: any):void {
        if (this.accountInfo == null) {
            $elem.find(this.selectors.auctionInstanceLoginButton).removeClass("d-none");
            $elem.find(this.selectors.auctionInstanceBidButton).addClass("d-none");
            $elem.find(this.selectors.auctionInstanceEnded).addClass("d-none");
        }  else {
            $elem.find(this.selectors.auctionInstanceLoginButton).addClass("d-none");
            if (auction.status == "ended") {
                $elem.find(this.selectors.auctionInstanceBidButton).addClass("d-none");
                $elem.find(this.selectors.auctionInstanceEnded).removeClass("d-none");
            } else {
                $elem.find(this.selectors.auctionInstanceBidButton).removeClass("d-none");
                $elem.find(this.selectors.auctionInstanceEnded).addClass("d-none");
            }
        }
    }

    /**
     * Initializes an auction GUI element from an auction data structure that looks like this:
     *
     * {
     *      bid_multiplier_x100k: 105000
     *      bid_price: "0.0300"
     *      bidder_timecoins_per_eos: 50
     *      block_time: 1542635132
     *      creation_time: 1542635122
     *      enabled: 1
     *      expires: 1542635152
     *      house_portion_x100k: 9625
     *      id: 11659
     *      init_bid_count: 25
     *      init_bid_price: "0.0300 EOS"
     *      init_duration_secs: 30
     *      init_prize_pool: "0.2500 EOS"
     *      init_redzone_secs: 15
     *      last_bidder: "eostimecontr"
     *      paid_out: 0
     *      prize_pool: "0.2500"
     *      referrer_portion_x100k: 375
     *      remaining_bid_count: 25
     *      status: "active"
     *      type: 1000
     *      winner_timecoins_per_eos: 10
     * }
     *
     * @param {JQuery<HTMLElement>} $elem
     * @param auction
     */
    private initializeAuctionElement($elem:JQuery<HTMLElement>, auction: any): void {

        $elem.find(this.selectors.ribbonContainer).empty();
        if (auction.hasOwnProperty("html")) {
            $elem.find(this.selectors.ribbonContainer).html(auction.html);
        }

        $elem.find(this.selectors.auctionInstanceId).text(auction.type.toString() + "-" + auction.id.toString());
        $elem.find(this.selectors.auctionInstanceBidderOuter).addClass("d-none");
        $elem.find(this.selectors.auctionInstanceNoBidder).addClass("d-none");
        if (auction.last_bidder == Config.EOSTIME_CONTRACT) {
            $elem.find(this.selectors.auctionInstanceNoBidder + "." + this.currentLanguage).removeClass("d-none");
        } else {
            $elem.find(this.selectors.auctionInstanceBidderOuter).removeClass("d-none");
        }
        $elem.find(this.selectors.auctionInstanceBidder).text(auction.last_bidder);
        $elem.find(this.selectors.auctionInstancePrizePool).text(auction.prize_pool);
        $elem.find(this.selectors.auctionInstanceRemainingBids).text(auction.remaining_bid_count);
        $elem.find(this.selectors.auctionInstanceBidAmount).text(auction.bid_price);
        $elem.data("lastUpdateTime", Math.floor(new Date().getTime()/1000));
        this.updateAuctionElementButtonState($elem, auction);
        this.updateRemainingTime($elem);
        $elem.find(this.selectors.auctionInstanceBidButton).on("click", (event) => {
            let $currentTarget:JQuery<HTMLElement> = $(event.currentTarget);
            let $auctionElement:JQuery<HTMLElement> = $currentTarget.closest(this.selectors.auctionInstance);
            this.eosBid($auctionElement).then((result) => {

                // TODO Temporary, we really update the GUI only on message coming back from server and don't deal with the promise
                let auction:any = $auctionElement.data("auction");
                auction.remaining_bid_count = result.remaining_bid_count;
                auction.last_bidder = result.last_bidder;
                auction.prize_pool = result.prize_pool;
                auction.expires = result.expires;
                this.updateAuctionElement($auctionElement);

                $currentTarget.focusout();
            }).catch((err) => {
                console.log(err);
            });
        });
        $elem.find(".auction-instance-info").on("click", (event) => {

            // Hide other content
            $('#info_modal').find(".modal-title-inner").addClass("d-none");
            $('#info_modal').find(".modal-body-inner").addClass("d-none");

            let modalIdentifier:string = $(event.currentTarget).attr('data-id');
            $('#info_modal').find("." + modalIdentifier + "." + this.currentLanguage).removeClass("d-none");

            // Update the fields in the modal
            let auction:any = $(event.currentTarget).parents(this.selectors.auctionInstance).data("auction");
            let $title:JQuery<HTMLElement> = $('#info_modal .modal-title').find("." + modalIdentifier + "." + this.currentLanguage)
            let $body:JQuery<HTMLElement> = $('#info_modal .modal-body').find("." + modalIdentifier + "." + this.currentLanguage)
            $title.find("span").text(auction.type.toString() + " - " + auction.id.toString());
            $body.find(".auction-instance-modal-prize").text(auction.prize_pool);
            $body.find("").addClass("d-none");
            $body.find(".auction-instance-modal-leader").addClass("d-none");
            if (auction.last_bidder == Config.EOSTIME_CONTRACT) {
                let selector:string = ".auction-instance-modal-leader.no-bidders";
                $body.find(".auction-instance-modal-leader.no-bidders").removeClass("d-none");
            } else {
                $body.find(".auction-instance-modal-leader.has-bidders").text(auction.last_bidder).removeClass("d-none");
            }

            let timeTokens:number = auction.bidder_timecoins_per_eos*parseFloat(auction.bid_price);
            $body.find(".auction-instance-modal-time-tokens").text(timeTokens.toFixed(4));

            $body.find(".auction-instance-modal-bid-price").text(auction.bid_price);

            if (auction.bid_multiplier_x100k != 100000) {
                let val:number = auction.bid_multiplier_x100k/1000 - 100;
                $body.find(".auction-instance-modal-bid-price-increase").text(val.toFixed(2) + "%");
                $body.find(".auction-instance-modal-bid-price-increase-outer").removeClass("d-none");
            } else {
                $body.find(".auction-instance-modal-bid-price-increase-outer").addClass("d-none");
            }

            $body.find(".auction-instance-modal-time-redzone").text(auction.init_redzone_secs.toString());

            // Show the auction instance containers (both title and body)
            $('#info_modal').find("." + modalIdentifier + "." + this.currentLanguage).removeClass("d-none");

            // Popup the modal
            (<any> $('#info_modal')).modal('show');
        });
        $elem.find(this.selectors.auctionInstanceLoginButton).on("click", (event) => {
            let evt:CustomEvent = new CustomEvent("logIn", {});
            document.dispatchEvent(evt);
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
        $elem.find(this.selectors.auctionInstanceId).text(auction.type.toString() + "-" + auction.id.toString());
        $elem.find(this.selectors.auctionInstanceRemainingBids).text(auction.remaining_bid_count);

        $elem.find(this.selectors.auctionInstanceBidderOuter).addClass("d-none");
        $elem.find(this.selectors.auctionInstanceNoBidder).addClass("d-none");
        if (auction.last_bidder == Config.EOSTIME_CONTRACT) {
            $elem.find(this.selectors.auctionInstanceNoBidder + "." + this.currentLanguage).removeClass("d-none");
        } else {
            $elem.find(this.selectors.auctionInstanceBidderOuter).removeClass("d-none");
        }

        $elem.find(this.selectors.auctionInstanceBidder).text(auction.last_bidder);
        $elem.find(this.selectors.auctionInstancePrizePool).text(auction.prize_pool);
        $elem.find(this.selectors.auctionInstanceBidAmount).text(auction.bid_price);
        this.updateAuctionElementButtonState($elem, auction);

        $elem.find(this.selectors.ribbonContainer).empty();
        if (auction.hasOwnProperty("html")) {
            $elem.find(this.selectors.ribbonContainer).html(auction.html);
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
    private updateRemainingTime($elem:JQuery<HTMLElement>, auction:any = null): void {
        if (!auction) {
            auction = $elem.data("auction");
        }
        if (auction) {
            let clientTime:number = Math.floor(new Date().getTime()/1000);
            let lastUpdateTime:number = <number> $elem.data("lastUpdateTime");
            if (!lastUpdateTime) {
                lastUpdateTime = clientTime;
            }
            let secsSinceLastUpdate:number = clientTime - lastUpdateTime;
            let now: number = auction.block_time + secsSinceLastUpdate;
            let remainingSecs: number = auction.expires - now;
            if (remainingSecs < 0) {
                remainingSecs = 0;
            }
            let days: number = Math.floor(remainingSecs / 86400);
            if (!isNaN(days)) {
                if (days > 0) {
                    let fmtDays:string = days > 9 ? days.toString() : "0" + days.toString();
                    $elem.find(this.selectors.daysContainer).removeClass("d-none");
                    $elem.find(this.selectors.daysContainer).html(days.toString() + "<span style='font-size:75%' class='grey-text'>d </span>");
                    $elem.find(this.selectors.auctionInstanceDays).text(fmtDays);
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
                $elem.find(this.selectors.auctionInstanceHours).text(hoursStr);
                $elem.find(this.selectors.auctionInstanceMinutes).text(minsStr);
                $elem.find(this.selectors.auctionInstanceSeconds).text(secsStr);
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
            let busy:boolean = !$auctionElement.find(this.selectors.auctionInstanceBusy).hasClass("d-none");
            if (this.eos && !busy) {

                let auction:any = $auctionElement.data("auction");
                const options = {authorization: [`${this.account.name}@${this.account.authority}`]};
                const assetAndQuantity:string = auction.bid_price + " EOS";
                let memo:string = "RZBID-" + auction.id;
                if (this.referrer) {
                    memo += "-" + this.referrer;
                }
                try {
                    $auctionElement.find(this.selectors.auctionInstanceBusy).removeClass("d-none");
                    this.eos.transfer(this.account.name, Config.eostimeContract, assetAndQuantity, memo, options).then((result) => {
                        console.log(result);
                    }).catch(err => {
                        $auctionElement.find(this.selectors.auctionInstanceBusy).addClass("d-none");
                        try {
                            err = JSON.parse(err);
                        } catch (err) {};

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

                        // Indicate failure to user with an animation on the bid button
                        let $bidButton:JQuery<HTMLElement> = $auctionElement.find(".auction-instance-bid-button");
                        (<any> $bidButton).animateCss('headShake');
                        $bidButton.blur();
                    });
                } catch (err) {
                    alert("Bid Error");
                    console.log("Caught error");
                    console.log(err);
                }

            } else {
                reject(new Error("No eos object available or busy"));
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