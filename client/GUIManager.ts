///<reference path="../node_modules/@types/jquery/index.d.ts" />
import {Config, ViewState} from "./Config";
import {ViewStateObserver} from "./ViewStateObserver";
var i18next = require('i18next');

export enum EOS_NETWORK {
    MAINNET = 0,
    JUNGLE
}

export enum LANGUAGE {
    ENGLISH = "english",
    CHINESE = "chinese"
}

export class GUIManager extends ViewStateObserver {

    public static I18N:any[] = new Array<any>();

    private eos:any = null;
    private cpuGuage:Guage = null;
    private netGuage:Guage = null;

    private selectors:any = {
        "developerMode": ".developer-mode",
        "networkMenuDropdown": ".network-selector",
        "mainNetSelected": ".select-mainnet",
        "jungleSelected": ".select-jungle",
        "publicKey": ".public-key",
        "accountName": ".account-name",
        "devErrorMessageContainer": "#dev_error_message_container",
        "devErrorMessage": ".dev-error-message",
        "devErrorMessageRowTemplate": ".dev-error-message-row-template",
        "clearDevErrors": ".dev-clear-errors",
        "loginButton": ".login-button",
        "logoutButton": ".logout-button",
        "loggedOutView": ".logged-out-view",
        "loggedInView": ".logged-in-view",
        "uiBlocker": ".uiBlocker",
        "eosBalance": ".eos-balance",
        "coinBalance": ".coin-balance",
        "betAmount": "#bet_amount",
        "cpuGuage": ".cpu-gauge",
        "netGuage": ".net-gauge",
        "referrerLinkTag": ".referrer-link-tag",
        "languageSelector": ".select-lang",
        "languageElement": ".lang",
        "languageChinese": ".chinese",
        "languageEnglish": ".english",
        "termsAndConditionsLink": ".terms-and-conditions-link",
        "termsAndConditionsModal": "#terms_and_conditions_modal",
        "termsAndConditionsContent": ".terms-and-conditions-content",
        "termsAndConditionsButtonContainer": ".terms-and-conditions-agree-button-container",
        "termsAndConditionsButton": ".terms-and-conditions-agree-button"
    };

    private currentLanguage:string = LANGUAGE.ENGLISH;
    private eosNetwork:EOS_NETWORK = EOS_NETWORK.MAINNET;

    constructor() {
        super();
        this.attachEventHandlers();

        if (typeof(Storage) !== "undefined") {
            let currentLanguage:string = localStorage.getItem("currentLanguage");
            if (currentLanguage) {
                this.setLanguage(<LANGUAGE> currentLanguage);
            } else {
                this.setLanguage(<LANGUAGE> this.currentLanguage);
                localStorage.setItem("currentLanguage", this.currentLanguage);
            }
        }
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

    public updateConnectedNetwork(val:EOS_NETWORK):void {
        this.eosNetwork = val;
        $(".network-selector").addClass("d-none");
        if (val == EOS_NETWORK.MAINNET) {
            $(".network-selector.mainnet").removeClass("d-none");
        } else {
            $(".network-selector.jungle").removeClass("d-none");
        }
    }

    public setPublicKey(val:string):void {
        $(this.selectors.publicKey).html(val);
    }

    public updateReferralLink(accountName:string) {
        $(this.selectors.referrerLinkTag).attr("value", Config.REFERRAL_LINK_PREFIX + accountName);
    }

    public updateEOSBalance(eosBalance:string):void {
        $(this.selectors.eosBalance).text(parseFloat(eosBalance).toFixed(4));
        (<any> $(this.selectors.eosBalance)).animateCss("bounceIn");
        this.updateEOSStakedResources();
    }

    public updateCoinBalance(coinBalance:string):void {
        $(this.selectors.coinBalance).text(parseFloat(coinBalance).toFixed(4));
        (<any> $(this.selectors.coinBalance)).animateCss("bounceIn");
    }

    public showEOSStakedResources(show:boolean, cpu:number, net: number):void {
        if (show && (cpu !== null) && (net !== null) && ($(this.selectors.cpuGuage).children().length > 0) && ($(this.selectors.cpuGuage).children().length > 0)) {
            $(this.selectors.cpuGuage).removeClass("d-none");
            $(this.selectors.netGuage).removeClass("d-none");
            $(this.selectors.cpuGuage).attr("data-toggle", "tooltip").attr("data-placement","left").attr("title", cpu.toString() + "% CPU");
            $(this.selectors.netGuage).attr("data-toggle", "tooltip").attr("data-placement","right").attr("title", net.toString() + "% NET");
            (<any> $(this.selectors.cpuGuage)).tooltip();
            (<any> $(this.selectors.netGuage)).tooltip();
            if (cpu > 100) {
                cpu = 100;
            }
            if (net > 100) {
                net = 100;
            }
            this.cpuGuage = new Guage($(this.selectors.cpuGuage + " > canvas"), cpu, {textVal: "CPU"});
            this.netGuage = new Guage($(this.selectors.netGuage + " > canvas"), net, {textVal: "NET"});
        } else {
            $(this.selectors.cpuGuage).addClass("d-none");
            $(this.selectors.netGuage).addClass("d-none");
        }
    }

    /**
     * Updates our staked resources
     */
    public updateEOSStakedResources(showCpuToolTip:boolean = false, showNetToolTip:boolean = false):void {
        if (this.accountInfo && this.cpuGuage && this.netGuage) {
            this.eos.getAccount(this.accountInfo.account_name).then((result) => {
                this.accountInfo.cpu_limit = result.cpu_limit;
                this.accountInfo.net_limit = result.net_limit;
                let cpu:number = Math.floor(this.accountInfo.cpu_limit.used*100/this.accountInfo.cpu_limit.max);
                let net:number = Math.floor(this.accountInfo.net_limit.used*100/this.accountInfo.net_limit.max);
                let $cpuTooltip:any = <any> $(this.selectors.cpuGuage);
                $cpuTooltip.attr("title", cpu.toString() + "% CPU"); // .tooltip("fixTitle");
                $cpuTooltip.attr("data-original-title", cpu.toString() + "% CPU");
                let $netTooltip:any = <any> $(this.selectors.netGuage);
                $netTooltip.attr("title", net.toString() + "% NET"); // .tooltip("fixTitle");
                $netTooltip.attr("data-original-title", net.toString() + "% NET");
                if (cpu > 100) {
                    cpu = 100;
                }
                if (net > 100) {
                    net = 100;
                }
                this.cpuGuage.draw(cpu);
                this.netGuage.draw(net);

                (<any> $(this.selectors.cpuGuage)).tooltip('hide');
                (<any> $(this.selectors.netGuage)).tooltip('hide');
                if (showCpuToolTip) {
                    (<any> $(this.selectors.cpuGuage)).tooltip('show');
                }
                if (showNetToolTip) {
                    (<any> $(this.selectors.netGuage)).tooltip('show');
                }
            });
        }
    }

    public notifyCurrentLanguage():void {
        let evt:CustomEvent = new CustomEvent("currentLanguage", {"detail": this.currentLanguage});
        document.dispatchEvent(evt);
    }

    // ========================================================================
    // PROTECTED METHODS
    // ========================================================================

    protected setLoggedInView(account:any, accountInfo:any):void {
        super.setLoggedInView(account, accountInfo);

        $(this.selectors.loggedInView).removeClass("d-none");
        $(this.selectors.loggedOutView).addClass("d-none");

        let selector:string = (this.currentLanguage == LANGUAGE.ENGLISH) ? LANGUAGE.CHINESE : LANGUAGE.ENGLISH;
        $("." + selector).addClass("d-none");

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

        $(this.selectors.loginButton).addClass("d-none");
        $(this.selectors.logoutButton).addClass("d-none");
        $(this.selectors.logoutButton).removeClass('d-none');
        (<any> $('[data-toggle="tooltip"]')).tooltip();
    }

    protected setLoggedOutView():void {
        super.setLoggedOutView();
        $(this.selectors.loggedInView).addClass("d-none");
        $(this.selectors.loggedOutView).removeClass("d-none");
        $(this.selectors.publicKey).html("");
        $(this.selectors.accountName).html("");

        let selector:string = (this.currentLanguage == LANGUAGE.ENGLISH) ? LANGUAGE.CHINESE : LANGUAGE.ENGLISH;
        $("." + selector).addClass("d-none");

        $(this.selectors.loginButton).addClass("d-none");
        $(this.selectors.logoutButton).addClass("d-none");
        $(this.selectors.loginButton).removeClass('d-none');
        (<any> $('[data-toggle="tooltip"]')).tooltip();
    }

    // ========================================================================
    // PRIVATE METHODS
    // ========================================================================

    private attachEventHandlers():void {

        $(document).on("termsAndConditions", () => {
            event.stopPropagation();
            (<any> $(this.selectors.termsAndConditionsModal)).modal("show");
        });

        $(this.selectors.termsAndConditionsLink).on("click", (event) => {
            event.stopPropagation();
            (<any> $(this.selectors.termsAndConditionsModal)).modal("show");
        });

        $(this.selectors.termsAndConditionsModal).on("show.bs.modal", async () => {

            try {
                await new Promise((resolve, reject) => {
                    let locale: string = Config.SUPPORTED_LANGUAGES[this.currentLanguage];
                    $(this.selectors.termsAndConditionsContent).empty().load('terms/' + locale + "/terms-and-conditions.html", (response, status, xhr) => {
                        if (status == "error") {
                            var msg = "Error loading the terms and conditions component: " + xhr.status + " " + xhr.statusText;
                            $(this.selectors.termsAndConditionsButtonContainer).addClass("d-none");
                            reject(new Error(msg));
                        } else {
                            if (!this.accountInfo) {
                                $(this.selectors.termsAndConditionsButtonContainer).addClass("d-none");
                            } else {
                                if (this.accountInfo.acceptedTerms) {
                                    $(this.selectors.termsAndConditionsButtonContainer).addClass("d-none");
                                } else {
                                    $(this.selectors.termsAndConditionsButtonContainer).removeClass("d-none");
                                }
                            }
                            resolve();
                        }
                    });
                });
            } catch (err) {
                console.log(err);
                let msg:string = "<div>" + (<any> $).t("common:missing_terms") + "</div>";
                msg += "<div style='padding-top: 10px'>" + err.message + "</div>";
                $(this.selectors.termsAndConditionsContent).html(msg);
            }
        });

        $(this.selectors.termsAndConditionsButton).on("click", (event) => {
            let evt:CustomEvent = new CustomEvent("acceptedTerms", {"detail": null});
            document.dispatchEvent(evt);
            (<any> $(this.selectors.termsAndConditionsModal)).modal("hide");
        });

        $(this.selectors.mainNetSelected).on("click", (event) => {
            // $(this.selectors.networkMenuDropdown).text("MainNet");
            let evt:CustomEvent = new CustomEvent("selectNetwork", {"detail": "mainnet"});
            document.dispatchEvent(evt);
        });

        $(this.selectors.cpuGuage).on("click", (event) => {
            this.updateEOSStakedResources(true, false);
        });
        $(this.selectors.netGuage).on("click", (event) => {
            this.updateEOSStakedResources(false, true);
        });

        $(this.selectors.jungleSelected).on("click", (event) => {
            // $(this.selectors.networkMenuDropdown).text("Jungle");
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
            setTimeout(() => {
                $(this.selectors.loginButton).blur();
            }, 100);


            // $(this.selectors.loginButton).addClass("d-none");
            // $(this.selectors.logoutButton).addClass("d-none");
            // $(this.selectors.loginButton + "." + this.currentLanguage).removeClass('d-none');
        });

        $(this.selectors.logoutButton).on("click", (event) => {
            let evt:CustomEvent = new CustomEvent("logOut", {"detail": ""});
            document.dispatchEvent(evt);

            // $(this.selectors.loginButton).addClass("d-none");
            // $(this.selectors.logoutButton).addClass("d-none");
            // $(this.selectors.logoutButton + "." + this.currentLanguage).removeClass('d-none');
        });

        $(this.selectors.betAmount).on("keypress", (event) => {
            var charCode:number = (event.which) ? event.which : event.keyCode;
            if ((charCode > 31 && charCode < 48 && charCode != 46) || charCode > 57) {
                return false;
            }
            return true;
        });

        // Handles language selection (done with direct references to selectors because
        // I copped it from Tom's JS code and didn't feel like mapping it).
        $('.select-lang').on('click', (event) => {
            var lang:string = $(event.currentTarget).data("lang");
            this.setLanguage(<LANGUAGE> lang);
        });

        $('.info-modal').on('click', (event) => {
            $('#info_modal').find(".modal-title-inner").addClass("d-none");
            $('#info_modal').find(".modal-body-inner").addClass("d-none");

            let modalIdentifier:string = $(event.currentTarget).attr('data-id');
            $('#info_modal').find("." + modalIdentifier + "." + this.currentLanguage).removeClass("d-none");
            (<any> $('#info_modal')).modal('show');
        });

        // Listen for a new eos blockchain object
        $(document).on("updateEos", (event) => {
            this.eos = event.detail;
            if (this.eos) {
                this.updateEOSStakedResources();
            }
        });
    }

    /**
     * Updates the GUI to reflect the specified language
     * @param {LANGUAGE} language
     */
    private setLanguage(language:LANGUAGE) {
        this.currentLanguage = language;
        localStorage.setItem("currentLanguage", language);

        $('.lang').addClass('d-none');
        $("." + this.currentLanguage).removeClass('d-none');
        if (this.accountInfo) {
            this.setLoggedInView(this.account, this.accountInfo);
        } else {
            this.setLoggedOutView();
        }

        this.notifyCurrentLanguage();

        this.updateConnectedNetwork(this.eosNetwork);

        // Updates the login / logout buttons
        $(this.selectors.loginButton).addClass("d-none");
        $(this.selectors.logoutButton).addClass("d-none");
        if (this.accountInfo) {
            $(this.selectors.logoutButton).removeClass('d-none');
            (<any> $('[data-toggle="tooltip"]')).tooltip();
        } else {
            $(this.selectors.loginButton).removeClass('d-none');
        }

        i18next.changeLanguage(Config.SUPPORTED_LANGUAGES[this.currentLanguage]).then(() => {
            this.updateLocalizedContent();

            // Update programatically set text
            for (let key in GUIManager.I18N) {
                GUIManager.I18N[key]["elem"].html((<any> $).t(key, GUIManager.I18N[key]["params"]));
            }
        });
    }

    private updateLocalizedContent():void {
        let $elements:any = <any> $(".localize");
        $elements.localize();
    }
}

/**
 * Class to produce a confetti effect on a div
 */
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
                if (this.canvasElement) {
                    this.canvasElement.width = this.elem.clientWidth;
                    this.canvasElement.height = this.elem.clientHeight;
                }
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

/**
 * Class to draw a guage
 */
export class Guage {

    private guageRenderer:GuageRenderer;

    constructor($canvas:JQuery<HTMLElement>, val:number, options:any) {

        let guageType:string = Config.safeProperty(options, ["type"], "default");
        if (guageType == "default") {
            this.guageRenderer = new DefaultGuageRenderer($canvas, val, options);
        } else {
            this.guageRenderer = new HalfCircleGuageRenderer($canvas, val, options);
        }
        this.guageRenderer.draw(val);
    }

    public draw(val:number) {
        this.guageRenderer.draw(val);
    }
}

/**
 * Inner class to render a guage
 */
abstract class GuageRenderer {

    protected val:number;
    protected settings:any
    protected ctx:CanvasRenderingContext2D;
    protected W;
    protected H;
    protected centerW;
    protected position;
    protected new_position;
    protected difference;
    protected text:string;
    protected animation_loop;

    constructor($canvas:JQuery<HTMLElement>, val:number, options:any) {
        this.settings = $.extend({}, Config.GUAGE_OPTIONS.yellow, options);
        this.val = val;

        let htmlElement:any = <any> $canvas[0];
        this.ctx = htmlElement.getContext("2d");

        this.W = htmlElement.width;
        this.H = htmlElement.height;
        this.centerW = (this.W/2);

        this.position = 0;
        this.new_position = 0;
        this.difference = 0;
    }

    // Angle in radians = angle in degrees * PI / 180
    protected radians(degrees) {
        return degrees * Math.PI / 180;
    }

    protected animateTo(): void {
        // Clear animation loop if degrees reaches the new_degrees
        if (this.position == this.new_position) {
            clearInterval(this.animation_loop);
        }

        if (this.position < this.new_position)
            this.position++;
        else
            this.position--;

        this.update();
    }

    public abstract draw(val):void;
    protected abstract update():void;
}

/**
 * Implementation of a circular guage renderer
 */
class DefaultGuageRenderer extends GuageRenderer {

    constructor($canvas:JQuery<HTMLElement>, val:number, options:any) {
        super($canvas, val, options);
    };

    public draw(val:number = null):void {
        // Cancel any animation if a new chart is requested
        if (typeof this.animation_loop !== undefined) {
            clearInterval(this.animation_loop);
        }
        if (val) {
            this.val = val;
        }
        this.new_position = Math.round((this.val / (this.settings.max - this.settings.min)) * 270);
        this.difference = this.new_position - this.position;
        this.animation_loop = setInterval(this.animateTo.bind(this), 100 / this.difference);
    }

    protected update():void {
        this.ctx.clearRect(0, 0, this.W, this.H);

        // The gauge will be an arc
        this.ctx.beginPath();
        this.ctx.strokeStyle = this.settings.bgcolor;
        this.ctx.lineWidth = this.W*0.13;
        this.ctx.arc(this.centerW, this.H - (this.centerW - this.ctx.lineWidth), (this.centerW) - this.ctx.lineWidth, this.radians(135), this.radians(45), false);
        this.ctx.stroke();

        this.ctx.beginPath();
        this.ctx.strokeStyle = this.settings.activeColor;
        this.ctx.lineWidth = this.W*0.13;

        if (this.position > 0) {
            this.ctx.globalAlpha = this.settings.colorAlpha;
            this.ctx.arc(this.centerW, this.H - (this.centerW - this.ctx.lineWidth), (this.centerW) - this.ctx.lineWidth, this.radians(135), this.radians(135 + this.position), false);
            this.ctx.stroke();
            this.ctx.globalAlpha = 1;
        }

        // Add the text
        this.ctx.fillStyle = this.settings.color;
        let fontArgs = this.ctx.font.split(' ');
        this.ctx.font = (this.W*0.15) + ' ' + fontArgs[fontArgs.length - 1];
        this.text = this.settings.textVal == null ? this.val + this.settings.unit : this.settings.textVal;
        // Center the text, deducting half of text width from position x
        let text_width = this.ctx.measureText(this.text).width;
        this.ctx.fillText(this.text, this.centerW - text_width / 2, this.H - (this.centerW - this.ctx.lineWidth) + 3);
    }

}

/**
 * Implementation of a half circle guage renderer
 */
class HalfCircleGuageRenderer extends GuageRenderer {

    constructor($canvas:JQuery<HTMLElement>, val:number, options:any) {
        super($canvas, val, options);
    };

    public draw(val:number = null):void {
        // Cancel any animation if a new chart is requested
        if (typeof this.animation_loop !== undefined) {
            clearInterval(this.animation_loop);
        }
        if (val) {
            this.val = val;
        }
        this.new_position = Math.round((this.val / (this.settings.max - this.settings.min)) * 180);
        this.difference = this.new_position - this.position;
        this.animation_loop = setInterval(this.animateTo.bind(this), 100 / this.difference);
    }

    protected update():void {
        this.ctx.clearRect(0, 0, this.W, this.H);

        // The gauge will be an arc
        this.ctx.beginPath();
        this.ctx.strokeStyle = this.settings.bgcolor;
        this.ctx.lineWidth = this.W * 0.13;
        this.ctx.arc(this.centerW, this.H, (this.centerW) - this.ctx.lineWidth, this.radians(180), this.radians(0), false);
        this.ctx.stroke();

        this.ctx.beginPath();
        this.ctx.strokeStyle = this.settings.color;
        this.ctx.lineWidth = this.W * 0.13;

        if (this.position > 0) {
            this.ctx.arc(this.centerW, this.H, (this.centerW) - this.ctx.lineWidth, this.radians(180), this.radians(180 + this.position), false);
            this.ctx.stroke();
        }

        // Add the text
        this.ctx.fillStyle = this.settings.color;
        var fontArgs = this.ctx.font.split(' ');
        this.ctx.font = (this.W*0.16) + ' ' + fontArgs[fontArgs.length - 1];
        this.text = this.val + this.settings.unit;
        // Center the text, deducting half of text width from position x
        let text_width = this.ctx.measureText(this.text).width;
        this.ctx.fillText(this.text, this.centerW - text_width / 2, this.H - 10);

    }
}