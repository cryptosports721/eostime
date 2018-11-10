///<reference path="../node_modules/@types/jquery/index.d.ts" />
import {Config, ViewState} from "./Config";
import {ViewStateObserver} from "./ViewStateObserver";

export enum EOS_NETWORK {
    MAINNET = 0,
    JUNGLE
}

export class GUIManager extends ViewStateObserver {

    private selectors:any = {
        "developerMode": ".developer-mode",
        "networkMenuContainer": "#network_selector_containerr",
        "networkMenuDropdown": "#network_selector",
        "mainNetSelected": "#select_mainnet",
        "jungleSelected": "#select_jungle",
        "publicKey": ".public-key",
        "accountName": ".account-name",
        "devErrorMessageContainer": "#dev_error_message_container",
        "devErrorMessage": ".dev-error-message",
        "devErrorMessageRowTemplate": ".dev-error-message-row-template",
        "clearDevErrors": ".dev-clear-errors",
        "betSlider": "#bet_slider",
        "betSliderContainer": "#bet_slider_container",
        "rollUnder": ".roll-under",
        "rollUnderButton": "#roll_under_button",
        "loginButton": ".login-button",
        "logoutButton": ".logout-button",
        "loggedOutView": ".logged-out-view",
        "loggedInView": ".logged-in-view",
        "uiBlocker": ".uiBlocker",
        "eosBalance": ".eos-balance",
        "coinBalance": ".eroll-balance",
        "betAmount": "#bet_amount"
    }

    constructor() {
        super();
        this.attachEventHandlers();
        this.setupSlider();
    }

    // ========================================================================
    // PUBLIC METHODS
    // ========================================================================

    public enableDevGui():void {
        $(this.selectors.developerMode).removeClass("d-none");
    }

    public blockUI(block:boolean):void {
        if (block) {
            $(this.selectors.uiBlocker).removeClass("d-none");
        } else {
            $(this.selectors.uiBlocker).addClass("d-none");
        }
    }

    public onClearDevErrors():void {
        $(this.selectors.devErrorMessageContainer).empty();
    }

    public onDevError(err:string):void {
        $(this.selectors.clearDevErrors).empty().removeClass("clearDevErrors");
        let $clone:JQuery<HTMLElement> = $(this.selectors.devErrorMessageRowTemplate).clone().removeClass(this.selectors.devErrorMessageRowTemplate.substr(1)).removeClass("d-none");
        $clone.find(this.selectors.devErrorMessage).html(err);
        $clone.find(this.selectors.clearDevErrors).html("<span>clear</span>");
        $clone.find(this.selectors.clearDevErrors + " span").on("click", (event) => {
            $(this.selectors.devErrorMessageContainer).empty();
        });
        $(this.selectors.devErrorMessageContainer).append($clone);
    }

    public onError(err:string):void {
        // TODO HANDLE ERROR MESSAGES IN USER GUI
    }

    public setNetworkMenu(val:string):void {
        $(this.selectors.networkMenuDropdown).text(val);
    }

    public updateConnectedNetwork(val:EOS_NETWORK):void {
        switch (val) {
            case EOS_NETWORK.JUNGLE:
                $(this.selectors.networkMenuDropdown).text("Jungle");
                break;
            case EOS_NETWORK.MAINNET:
                $(this.selectors.networkMenuDropdown).text("MainNet");
                break;
        }
    }

    public setPublicKey(val:string):void {
        $(this.selectors.publicKey).html(val);
    }

    public updateEOSBalance(eosBalance:string):void {
        $(this.selectors.eosBalance).text(parseFloat(eosBalance).toFixed(4));
    }

    public updateCoinBalance(coinBalance:string):void {
        $(this.selectors.coinBalance).text(parseInt(coinBalance));
    }

    // ========================================================================
    // PRIVATE METHODS
    // ========================================================================

    private attachEventHandlers():void {

        $(this.selectors.mainNetSelected).on("click", (event) => {
            $(this.selectors.networkMenuDropdown).text("MainNet");
            let evt:CustomEvent = new CustomEvent("selectNetwork", {"detail": "mainnet"});
            document.dispatchEvent(evt);
        });

        $(this.selectors.jungleSelected).on("click", (event) => {
            $(this.selectors.networkMenuDropdown).text("Jungle");
            let evt:CustomEvent = new CustomEvent("selectNetwork", {"detail": "jungle"});
            document.dispatchEvent(evt);
        });

        $(this.selectors.rollUnderButton).on("click", (event) => {
            let rollUnderVal:number = <number> $(this.selectors.betSlider).val();

            let val:string = <string> $(this.selectors.betAmount).val();
            let valFloat:number = parseFloat(val);
            if (isNaN(valFloat)) {
                // TODO Reflect error to user
                return false;
            }

            let payload:any = {"detail": {"rollUnder": rollUnderVal, "betAmount": valFloat}};
            let evt:CustomEvent = new CustomEvent("rollUnder", payload);
            document.dispatchEvent(evt);
        });

        $(this.selectors.loginButton).on("click", (event) => {
            let evt:CustomEvent = new CustomEvent("logIn", {"detail": ""});
            document.dispatchEvent(evt);
        });

        $(this.selectors.logoutButton).on("click", (event) => {
            let evt:CustomEvent = new CustomEvent("logOut", {"detail": ""});
            document.dispatchEvent(evt);
        });

        $(this.selectors.betAmount).on("keypress", (event) => {
            var charCode:number = (event.which) ? event.which : event.keyCode;
            if ((charCode > 31 && charCode < 48 && charCode != 46) || charCode > 57) {
                return false;
            }
            return true;
        });
    }

    protected setLoggedInView(account:any, accountInfo:any):void {
        super.setLoggedInView(account, accountInfo);

        $(this.selectors.loggedInView).removeClass("d-none");
        $(this.selectors.loggedOutView).addClass("d-none");
        if (accountInfo) {

            let publicKey:string = Config.firstActivePublicKeyFromAccountInfo(accountInfo);
            if (publicKey) {
                $(this.selectors.publicKey).html(publicKey);
            }

            // let spaceLoc:number = accountInfo.core_liquid_balance.indexOf(" ");
            // let eosBalance:string = (spaceLoc > 0) ? accountInfo.core_liquid_balance.substr(0, spaceLoc) : accountInfo.core_liquid_balance;
            // eosBalance = parseFloat(eosBalance).toFixed(4);
            // $(this.selectors.eosBalance).text(eosBalance);

            $(this.selectors.accountName).html(accountInfo.account_name);
        }
    }

    protected setLoggedOutView():void {
        super.setLoggedOutView();
        $(this.selectors.loggedInView).addClass("d-none");
        $(this.selectors.loggedOutView).removeClass("d-none");
        $(this.selectors.publicKey).html("");
        $(this.selectors.accountName).html("");
    }

    private setupSlider():void {

        $(this.selectors.betSliderContainer).removeClass("d-none");

        $(this.selectors.betSlider).slider({
            "tooltip": "always",
            "tooltip_position": "bottom",
            "formatter": function(value:number) {
                return value.toString();
            }
        });

        $(this.selectors.betSlider).on("slide", (slideEvt:any) => {
            $(this.selectors.rollUnder).text(slideEvt.value);
        });

        $(this.selectors.rollUnder).text($(this.selectors.betSlider).val().toString());
    }
}

export class Confetti {

    private elem:HTMLElement = null;
    private maxParticleCount:number = 150;
    private particleSpeed:number = 2;
    private colors:string[] = ["DodgerBlue", "OliveDrab", "Gold", "Pink", "SlateBlue", "LightBlue", "Violet", "PaleGreen", "SteelBlue", "SandyBrown", "Chocolate", "Crimson"]
    private streamingConfetti:boolean = false;
    private animationTimer:number = null;
    private particles:any[] = new Array<any>();
    private waveAngle:number = 0;
    private context:CanvasRenderingContext2D = null;
    private canvasElement:any;

    /**
     * Constructor
     * @param {HTMLElement} elem
     */
    constructor(elem:HTMLElement) {
        this.elem = elem;
        window["requestAnimFrame"] = (function() {
            return window.requestAnimationFrame ||
                window.webkitRequestAnimationFrame ||
                window["mozRequestAnimationFrame"] ||
                window["oRequestAnimationFrame"] ||
                window["msRequestAnimationFrame"] ||
                function (callback) {
                    return window.setTimeout(callback, 16.6666667);
                };
        })();
    }

    /**
     * Resets an individual particle
     * @param particle
     * @param width
     * @param height
     */
    public resetParticle(particle, width, height):void {
        particle.color = this.colors[(Math.random() * this.colors.length) | 0];
        particle.x = Math.random() * width;
        particle.y = Math.random() * height - height;
        particle.diameter = Math.random() * 10 + 5;
        particle.tilt = Math.random() * 10 - 10;
        particle.tiltAngleIncrement = Math.random() * 0.07 + 0.05;
        particle.tiltAngle = 0;
        return particle;
    }

    /**
     * Starts the confetti flowing
     */
    public startConfetti() {
        let width:number = this.elem.clientWidth;
        let height:number = this.elem.clientHeight
        var existingCanvas:any = document.getElementById("confetti-canvas");
        if (existingCanvas === null) {
            this.canvasElement = document.createElement("canvas");
            this.canvasElement.setAttribute("class", "confetti-canvas");
            this.elem.appendChild(this.canvasElement);
            this.canvasElement.width = width;
            this.canvasElement.height = height;
            window.addEventListener("resize", (event) => {
                this.canvasElement.width = this.elem.clientWidth;
                this.canvasElement.height = this.elem.clientHeight;
            }, true);
        }
        this.context = this.canvasElement.getContext("2d");
        while (this.particles.length < this.maxParticleCount) {
            this.particles.push(this.resetParticle({}, width, height));
        }
        this.streamingConfetti = true;
        if (this.animationTimer === null) {
            this.runAnimation();
        }
    }

    /**
     * Stops the confetti from flowing
     */
    public stopConfetti() {
        this.streamingConfetti = false;
    }

    /**
     * Removes the confetti
     */
    public removeConfetti() {
        if (this.canvasElement) {
            this.stopConfetti();
            this.particles = [];
            this.context = null;
            this.animationTimer = null;
            this.elem.removeChild(this.canvasElement);
            this.canvasElement = null;
        }
    }

    private toggleConfettiInner() {
        if (this.streamingConfetti)
            this.stopConfetti();
        else
            this.startConfetti();
    }

    private drawParticles(context:CanvasRenderingContext2D) {
        for (let i:number = 0; i < this.particles.length; i++) {
            let particle:any = this.particles[i];
            context.beginPath();
            context.lineWidth = particle.diameter;
            context.strokeStyle = particle.color;
            let x:number = particle.x + particle.tilt;
            context.moveTo(x + particle.diameter / 2, particle.y);
            context.lineTo(x, particle.y + particle.tilt + particle.diameter / 2);
            context.stroke();
        }
    }

    private updateParticles() {

        let width = this.elem.clientWidth;
        let height = this.elem.clientHeight;
        this.waveAngle += 0.01;
        for (var i = 0; i < this.particles.length; i++) {
            let particle:any = this.particles[i];
            if (!this.streamingConfetti && particle.y < -15)
                particle.y = height + 100;
            else {
                particle.tiltAngle += particle.tiltAngleIncrement;
                particle.x += Math.sin(this.waveAngle);
                particle.y += (Math.cos(this.waveAngle) + particle.diameter + this.particleSpeed) * 0.5;
                particle.tilt = Math.sin(particle.tiltAngle) * 15;
            }
            if (particle.x > width + 20 || particle.x < -20 || particle.y > height) {
                if (this.streamingConfetti && this.particles.length <= this.maxParticleCount)
                    this.resetParticle(particle, width, height);
                else {
                    this.particles.splice(i, 1);
                    i--;
                }
            }
        }
    }

    private runAnimation():void {

        const runAnimationInner = function() {
            if (this.canvasElement) {
                this.context.clearRect(0, 0, window.innerWidth, window.innerHeight);
                if (this.particles.length === 0)
                    this.animationTimer = null;
                else {
                    this.updateParticles();
                    this.drawParticles(this.context);
                    this.animationTimer = window["requestAnimFrame"](runAnimationInner);
                }
            }
        }.bind(this);
        runAnimationInner();

    }
}