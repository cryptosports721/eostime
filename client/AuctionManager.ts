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
        "auctionInstanceBidder": ".auction-instance-bidder-account-name",
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
        "ribbonContainer": ".ribbon-container",
        "auctionClientSeed": ".auction-instance-client-seed",
        "auctionServerHash" : ".auction-instance-server-hash",
        "auctionBombButton" : ".auction-instance-bomb-button",
        "auctionBombOdds" : ".auction-instance-bomb-odds"
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

            this.addWinnerToLeaderBoard(auction, !Config.LIMITED_MOBILE_UI);

            if (this.accountInfo && auction.last_bidder == this.accountInfo.account_name) {
                setTimeout(() => {
                    let evt:CustomEvent = new CustomEvent("updateCoinBalances", {});
                    document.dispatchEvent(evt);
                }, 3000);
            }
        });

        this.socketMessage.getSocket().on(SocketMessage.STC_BID_SIGNATURE, (payload:any) => {
            payload = JSON.parse(payload);
            let $auctionElementToUpdate: JQuery<HTMLElement> = this.auctionElements.find(($elem:JQuery<HTMLElement>) => {
                let auctionToCheck:any = $elem.data("auction");
                return (auctionToCheck.type == payload.auctionType);
            });
            if ($auctionElementToUpdate) {
                this._eosBid($auctionElementToUpdate, payload.signature);
            }
        });

        this.socketMessage.getSocket().on(SocketMessage.STC_LEADER_CLIENT_SEED, (payload:any) => {
            payload = JSON.parse(payload);
            console.log("Leader seed in auction: " + payload.auctionId + " is " + payload.clientSeed);
            let $auctionElementToUpdate: JQuery<HTMLElement> = this.auctionElements.find(($elem:JQuery<HTMLElement>) => {
                let auctionToCheck:any = $elem.data("auction");
                return (auctionToCheck.id == payload.auctionId);
            });
            if ($auctionElementToUpdate) {
                let auctionData:any = $auctionElementToUpdate.data("auction");
                auctionData.clientSeed = payload.clientSeed;
                this.updateAuctionElement($auctionElementToUpdate);
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
            const newType:number = parseFloat(auction.type);
            const existingType:number = parseFloat(existingAuction.type);
            if (newType > existingType) {
                $clone.insertBefore($child);
                didInsert = true;
                return false;
            }
        });

        // Turn tool tips on for serverSeedHash
        $clone.find(this.selectors.auctionServerHash).attr("data-toggle", "tooltip").attr("data-placement","bottom");
        (<any> $clone.find(this.selectors.auctionServerHash)).tooltip();

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

            // Turn tool tips on for serverSeedHash
            $clone.find(this.selectors.auctionServerHash).attr("data-toggle", "tooltip").attr("data-placement","bottom");
            (<any> $clone.find(this.selectors.auctionServerHash)).tooltip();
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
            $elem.find(".bid-button-container").addClass("d-none");
            $elem.find(this.selectors.auctionInstanceEnded).addClass("d-none");
        }  else {
            $elem.find(this.selectors.auctionInstanceLoginButton).addClass("d-none");
            if (auction.status == "ended") {
                $elem.find(".bid-button-container").addClass("d-none");
                $elem.find(this.selectors.auctionInstanceEnded).removeClass("d-none");
            } else {
                $elem.find(".bid-button-container").removeClass("d-none");
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

        let $clockAcceleratesMesage:JQuery<HTMLElement> = $elem.find(".auction-instance-clock-accelerates-message");
        if (auction.clock_multiplier_x100k == 0.0) {
            $clockAcceleratesMesage.addClass("d-none");
        } else {
            $clockAcceleratesMesage.removeClass("d-none");
            (<any> $clockAcceleratesMesage).find('div').animateCss('pulse infinite');
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

        // Deal with harpoon functionality
        //
        if (auction.harpoon === 0) {
            // Not a harpoonable auction
            $elem.find(".bomb-button-col").addClass("d-none");
            $elem.find(".bid-button-col").removeClass("col-6").addClass("col-12");
            $elem.find(".bid-button-container").addClass("pl-5").addClass("pr-5");
        } else {

            // Client Seed Hash
            if (auction.clientSeed) {
                $elem.find(this.selectors.auctionClientSeed).removeClass("d-none").text(auction.clientSeed);
            } else {
                $elem.find(this.selectors.auctionClientSeed).addClass("d-none");
            }
            $elem.find(".auction-client-seed-container").removeClass("d-none");

            // Server Seed
            $elem.find(this.selectors.auctionServerHash).text(this.trimServerSeedHash(auction.serverSeedHash));
            $elem.find(this.selectors.auctionServerHash).attr("title", auction.serverSeedHash);
            $elem.find(this.selectors.auctionServerHash).attr("data-original-title", auction.serverSeedHash);
            (<any> $elem.find(this.selectors.auctionServerHash)).tooltip('hide');
            $elem.find(".auction-server-hash-container").removeClass("d-none");
        }

        $elem.data("lastUpdateTime", Math.floor(new Date().getTime()/1000));
        this.updateAuctionElementButtonState($elem, auction);
        this.updateRemainingTime($elem);
        $elem.find(this.selectors.auctionInstanceBidButton).on("click", (event) => {
            let $currentTarget:JQuery<HTMLElement> = $(event.currentTarget);
            let $auctionElement:JQuery<HTMLElement> = $currentTarget.closest(this.selectors.auctionInstance);
            this.eosBid($auctionElement).then((result) => {
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

            if ((auction.clock_multiplier_x100k != 0.0) && (auction.bid_multiplier_x100k != 100000)) {
                let val:number = auction.clock_multiplier_x100k/1000;
                $body.find(".auction-instance-modal-clock-accelerator").text(val.toFixed(2) + "%");
                $body.find(".auction-instance-modal-clock-accelerator-outer").removeClass("d-none");
            } else {
                $body.find(".auction-instance-modal-clock-accelerator-outer").addClass("d-none");
            }

            $body.find(".auction-instance-modal-remaining-bids").text(auction.remaining_bid_count);

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

        if (auction.clientSeed) {
            $elem.find(this.selectors.auctionClientSeed).removeClass("d-none").text(auction.clientSeed);
        } else {
            $elem.find(this.selectors.auctionClientSeed).addClass("d-none");
        }
        $elem.find(this.selectors.auctionServerHash).text(this.trimServerSeedHash(auction.serverSeedHash));
        $elem.find(this.selectors.auctionServerHash).attr("title", auction.serverSeedHash);
        $elem.find(this.selectors.auctionServerHash).attr("data-original-title", auction.serverSeedHash);
        (<any> $elem.find(this.selectors.auctionServerHash)).tooltip('hide');

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

    private trimServerSeedHash(val:string, len:number = 10):string {
        let toRet:string = "";
        for (let i:number = 0; i < len; i++) {
            toRet += val.charAt(i);
        }
        toRet += "...";
        for (let i:number = val.length - len; i < val.length; i++) {
            toRet += val.charAt(i);
        }
        return toRet;
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
     * Places a bid on an auction
     * @param {JQuery<HTMLElement>} $auctionElement
     * @returns {Promise<any>}
     */
    private eosBid($auctionElement:JQuery<HTMLElement>):Promise<any> {
        let auction:any = $auctionElement.data("auction");
        let random:number = Math.floor(Math.random()*100000);
        this.socketMessage.ctsGetBidSignature(auction.type, auction.bid_price, random);
        return Promise.resolve();
    }

    /**
     * Places a bid on the blockchain
     * @param $auctionElement
     * @param signature
     */
    private _eosBid($auctionElement:JQuery<HTMLElement>, signature:string):Promise<any> {
        return new Promise<any>(async (resolve, reject) => {
            let busy:boolean = !$auctionElement.find(this.selectors.auctionInstanceBusy).hasClass("d-none");
            if (this.eos && !busy) {

                let auction:any = $auctionElement.data("auction");
                const options = {authorization: [`${this.account.name}@${this.account.authority}`]};
                let assetAndQuantity:string = auction.bid_price + " EOS";

                let memo:string = null;
                if (signature) {
                    memo = "RZBID-" + signature + "-" + auction.id;
                } else {
                    memo = "RZBID-" + auction.id;
                }

                if (this.referrer) {
                    memo += "-" + this.referrer;
                }

                try {
                    $auctionElement.find(this.selectors.auctionInstanceBusy).removeClass("d-none");
                    this.eos.transfer(this.account.name, Config.eostimeContract, assetAndQuantity, memo, options).then((result) => {
                        console.log(result);
                    }).catch(err => {
                        console.log(err);
                        $auctionElement.find(this.selectors.auctionInstanceBusy).addClass("d-none");
                        try {
                            err = JSON.parse(err);
                        } catch (err) {};


                        // Notify user if he was outbid
                        let errorDetails:any[] = Config.safeProperty(err, ["error.details"], null);
                        if (errorDetails) {
                            let userErrorMessage:string = null;
                            for (let errorDetail of errorDetails) {
                                let em:string = Config.safeProperty(errorDetail, ["message"], null);
                                em = em.toLowerCase();
                                if (em.indexOf("incorrect amount sent") >= 0) {
                                    switch(this.currentLanguage) {
                                        case 'english':
                                            userErrorMessage = "Your bid came in after " + auction.last_bidder + ".";
                                            break;
                                        case 'chinese':
                                            userErrorMessage = "你的出价在之后出现了 " + auction.last_bidder + ".";
                                            break;
                                    }
                                    break;
                                }
                                if ((em.indexOf("redzone doesn't exist") >= 0) || (em.indexOf("redzone has ended") >= 0)) {
                                    switch(this.currentLanguage) {
                                        case 'english':
                                            userErrorMessage = "The auction ended before your bid was received.";
                                            break;
                                        case 'chinese':
                                            userErrorMessage = "拍卖会在收到您的出价之前结束";
                                            break;
                                    }
                                    break;
                                }
                                if (em.indexOf("error expected key different than recovered key")) {
                                    // User has been banned, but we don't really need to tell him that
                                    switch(this.currentLanguage) {
                                        case 'english':
                                            userErrorMessage = "Your bid resulted in an unexpected error. Please try again later.";
                                            break;
                                        case 'chinese':
                                            userErrorMessage = "您的出价导致意外错误。请稍后再试。";
                                            break;
                                    }
                                    break;
                                }
                            }
                            if (userErrorMessage) {
                                let title:string = "Bid Rejected";
                                if (this.currentLanguage == "chinese") {
                                    title = "出价被拒绝";
                                }
                                (<any> $).notify({
                                    title: "Bid Rejected",
                                    message: userErrorMessage
                                },{
                                    type: "info",
                                    allow_dismiss: false,
                                    delay: 4000,
                                    placement: {
                                        from: "top",
                                        align: "center"
                                    },
                                    template: '<div data-notify="container" class="col-xs-11 col-sm-3 alert alert-{0}" role="alert">' +
                                        '<button type="button" aria-hidden="true" class="close" data-notify="dismiss">×</button>' +
                                        '<span data-notify="icon"></span> ' +
                                        '<div data-notify="title"><i class="fas fa-gavel"></i>&nbsp;&nbsp;<strong>{1}</strong></div> ' +
                                        '<div><hr /></div>' +
                                        '<div data-notify="message" class="pb-1">{2}</div>' +
                                        '<div class="progress" data-notify="progressbar">' +
                                        '<div class="progress-bar progress-bar-{0}" role="progressbar" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100" style="width: 0%;"></div>' +
                                        '</div>' +
                                        '<a href="{3}" target="{4}" data-notify="url"></a>' +
                                        '</div>'
                                });
                            }
                        }

                        console.log(err);

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