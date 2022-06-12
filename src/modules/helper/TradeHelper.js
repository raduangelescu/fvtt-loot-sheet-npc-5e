import { MODULE } from "../data/moduleConstants.js";
import { ChatHelper } from "./ChatHelper.js";
import { CurrencyHelper } from "./CurrencyHelper.js";
import { ItemHelper } from "./ItemHelper.js";
import { PermissionHelper } from "./PermissionHelper.js";

/**
 * @Module LootsheetNPC5e.Helpers.TradeHelper
 * @name TradeHelper
 *
 * @classdec Static helper methods for trading
 *
 * @since 3.4.5.3
 * @author Daniel Böttner <daniel@est-in.eu>
 * @license MIT
 */
export class TradeHelper {

    /**
     * @summary Handle the trade between two actors
     *
     * @description This method handles the trade between two actors.
     *
     * It is called by the trade button on the loot sheet.
     * - in the future may -> It is also called by the trade button on the item sheet.
     * - in the future may -> It is also called by the trade button on the character sheet.
     *
     * @param {Actor} npcActor The NPC Actor that is trading with the player
     * @param {Actor} playerCharacter The Player Character that is trading with the NPC
     * @param {Array} trades The trades that are to be executed
     * @param {object} options The options for the trade
     *
     * @returns {Promise<boolean>}
     */
    static async tradeItems(npcActor, playerCharacter, trades, options = {}) {
        // for tradeType in object trades get the array
        for (let type in trades) {
            if (!trades[type].length > 0) continue;
            options.type = type;
            options.priceModifier = npcActor.getFlag(MODULE.ns, MODULE.flags.priceModifier) || { buy: 100, sell: 100 };
            this._handleTradyByType(trades, playerCharacter, npcActor, options);
        }
    }

    /**
     * @summary loot items from one actor to another
     *
     * @description Move items from one actor to another
     * Assumes that the set of items is valid and can be moved.
     *
     * @param {Actor} source
     * @param {Actor} destination
     * @param {Array<Item>} items
     *
     * @inheritdoc
     */
    static async lootItems(source, destination, items, options) {
        let movedItems = await ItemHelper.moveItemsToDestination(source, destination, items);
        ChatHelper.tradeChatMessage(source, destination, movedItems, options);

    }

    /**
     * @summary -- 👽☠️🏴‍☠️ All ya Items belong to us 🏴‍☠️☠️👽  --
     *
     * @description Gets the lootable subset of the items in
     * the source actor and moves this subset to the destination actor.
     *
     * @param {Actor} source
     * @param {Actor} destination
     *
     * @returns {Promise<Array<Item>>}
     *
     * @function
     *
     * @since 3.4.5.3
     * @author Daniel Böttner < @DanielBoettner >
     */
    static async lootAllItems(source, destination, options = {}) {
        const items = ItemHelper.getLootableItems(source.items).map((item) => ({
            id: item.id,
            data: {
                data: {
                    quantity: item.data.data.quantity
                }
            }
        }));

        this.lootItems(source, destination, items, options);
        this.lootCurrency(source, destination, options);
    }

    /**
     * Handle a buy transaction between a seller & a buyer
     *
     * @description
     * #### This could likely be refactored or scrubbed.
     * See [tradeItems](#tradeItems) for the more generic version.
     *
     * - First the buy item button in the inventory needs to be refactored.
     * - - The buttons action needs to be changed to tradeItems
     * - - The buttons class so it gets picket up by the actionButtons selector (eventListener)
     * - The items need to be parsed to resemble the item structure of items in the trade stage
     * - - see [_handleTradeStage](LootSheetNPC5e.Helpers.LootSheetNPC5eHelper._handleTradeStage) for more details
     * - - Maybe by making each html row(~item) a stage.
     *
     * @todo Refactor and make obsolete
     *
     * @see this.tradeItems for the more generic version
     * @see LootSheetNPC5e.Helpers.LootSheetNPC5eHelper._handleTradeStage for the stage handling
     *
     * @param {Actor} seller
     * @param {Actor} buyer
     * @param {string} itemId
     * @param {number} quantity
     * @param {object} options
     *
     * @returns {Promise<boolean>}
     *
     * @author Jan Ole Peek < @jopeek >
     * @author Daniel Böttner < @DanielBoettner >
     * @since 1.0.1
     *
     * @inheritdoc
     */
    static async transaction(seller, buyer, itemId, quantity, options = { chatOutPut: true }) {
        // On 0 quantity skip everything to avoid error down the line
        const soldItem = seller.getEmbeddedDocument("Item", itemId),
            priceModifier = seller.getFlag(MODULE.ns, MODULE.flags.priceModifier) || { buy: 100, sell: 100 };
        
        options.priceModifier = (options.type === 'buy') ? priceModifier.buy : priceModifier.sell;

        if (!soldItem) return ItemHelper.errorMessageToActor(seller, `${seller.name} doesn't posses this item anymore.`);
        console.warn(`${seller.name} is selling ${soldItem.name} for ${this._getItemPriceInGold(soldItem.data.data.price, options.priceModifier, quantity)} gold`);
        console.warn(`trade type: ${options.type}`);
        
        let moved = false;
        quantity = (soldItem.data.data.quantity < quantity) ? parseInt(soldItem.data.data.quantity) : parseInt(quantity);
        
        let originalItemPrice = soldItem.data.data.price,
            itemCostInGold = this._getItemPriceInGold(originalItemPrice, options.priceModifier, quantity),
            successfullTransaction = await this._updateFunds(seller, buyer, itemCostInGold);

        console.warn(`transaction |${originalItemPrice} | ${itemCostInGold} | ${options.priceModifier}`);

        if (!successfullTransaction) return false;
        moved = await ItemHelper.moveItemsToDestination(seller, buyer, [{ id: itemId, data: { data: { quantity: quantity } } }]);
        
        options.type = "buy";
        ChatHelper.tradeChatMessage(seller, buyer, moved, options);
    }

    /**
     * @summary  (🧑‍🎤🪙 ➗ 👥) - (🧑‍🎤🪙) -> 💰 -> 👥🪙 + 💰
     *
     * @description Split the currency of an actor between multiple eligable player actors
     *
     * @param {Actor} source
     * @param {options} options
     *
     * @returns {Promise<boolean>}
     */
    static async distributeCurrency(source, destination, options = { verbose: true }) {
        const eligables = PermissionHelper.getEligableActors(source),
            currency = CurrencyHelper.handleActorCurrency(source.data.data.currency),
            shares = CurrencyHelper.getSharesAndRemainder(currency, eligables.length);

        let splits = { shares: shares.currencyShares, receivers: [] };

        if (options.verbose) {
            let cmsg = `${MODULE.ns} | distributeCurrency |`;
            console.log(cmsg + ' actorData:', source.data);
            console.log(cmsg + ' players:', game.users.players);
            console.log(cmsg + ' observers:', eligables);
            console.log(cmsg + ' currencyShares:', shares.currencyShares);
            console.log(cmsg + ' npcRemainingCurrency', shares.remainder);
        }

        if (eligables.length === 0) return;

        for (let player of game.users.players) {
            let playerCharacter = player.character;
            if (!playerCharacter || !eligables.includes(player.id)) continue;

            let playerCurrency = duplicate(playerCharacter.data.data.currency),
                newCurrency = duplicate(playerCharacter.data.data.currency);

            splits.receivers.push(playerCharacter.data.name);
            console.log(splits);
            for (let c in playerCurrency) {
                newCurrency[c] = parseInt(playerCurrency[c] || 0) + shares.currencyShares[c];
            }

            await playerCharacter.update({ 'data.currency': newCurrency });
        }

        // set source funds to 0
        source.update({ "data.currency": { cp: 0, ep: 0, gp: 0, pp: 0, sp: 0 } });

        // update the chat
        if (!options.chatOutPut) return;
        ChatHelper.renderLootCurrencyMessage(source, destination, splits, options);
    }

    /**
     * @summary #### loot funds from an actor to another
     * @example 🧑‍🎤 -> 💰 -> 🧑‍🎤
     *
     * @description move the funds from one actor to another
     *
     *
     * @param {Actor5e} source
     * @param {User} destination
     * @param {object} options
     *
     * @returns {Promise<boolean>}
     * @author Jan Ole Peek <@jopeek>
     *
     * @since 1.0.1
     * @inheritdoc
     */
    static async lootCurrency(source, destination, options = { chatOutPut: true }) {
        const actorData = source.data;
        let sheetCurrency = duplicate(actorData.data.currency),
            originalCurrency = duplicate(destination.data.data.currency),
            newCurrency = duplicate(destination.data.data.currency),
            movedFunds = {};

        // calculate the new currency
        for (let c in originalCurrency) {
            if (sheetCurrency[c] != null) {
                newCurrency[c] = parseInt(originalCurrency[c] || 0) + parseInt(sheetCurrency[c]);
                movedFunds[c] = sheetCurrency[c];
            }
        }

        // set the destination currency to the new currency
        destination.update({ 'data.currency': newCurrency });

        // set source funds to 0
        source.update({ "data.currency": { cp: 0, ep: 0, gp: 0, pp: 0, sp: 0 } });

        // update the chat
        if (!options.chatOutPut) return;
        ChatHelper.renderLootCurrencyMessage(source, destination, movedFunds, options);
    }

    /**
     * @summary Handle a trade by its type
     * @description
     *
     * | Currently supported types |
     * | ---  | --- |
     * | buy  | Player actor buys from a NPC |
     * | sell | Player actor sells to NPC |
     * | loot | Player Actor loots from the NPC |
     * | --- | --- |
     *
     * @param {Array} trades
     * @param {Actor} playerCharacter
     * @param {Actor} npcActor
     * @param {object} options
     *
     * @returns {Promise<boolean>}
     *
     * @function
     * @inheritdoc
     * @since 3.4.5.3
     * @author Daniel Böttner <@DanielBoettner>
     *
     */
    static async _handleTradyByType(trades, playerCharacter, npcActor, options) {
        let moved = { sell: [], buy: [], give: [], loot: [] };

        const tradeType = options.type,
            playerActions = ['sell', 'give'],
            playerToNPC = playerActions.includes(tradeType),
            source = playerToNPC ? playerCharacter : npcActor,
            destination = playerToNPC ? npcActor : playerCharacter,
            tradeTypePriceModifier = options.priceModifier[tradeType=== 'sell' ? 'buy' : 'sell'];
            
        options.priceModifier = tradeTypePriceModifier;

        const preparedTrade = this._prepareTrade(source, trades[tradeType], options),
            successfullTransaction = await this.moneyExchange(source, destination, tradeType, preparedTrade.tradeSum, options);

        if (!successfullTransaction) return false;

        moved[tradeType] = await ItemHelper.moveItemsToDestination(source, destination, preparedTrade.items);
        ChatHelper.tradeChatMessage(npcActor, playerCharacter, moved[tradeType], options);
    }

    /**
     * @param {Actor} source
     * @param {Actor} destination
     * @param {string} tradeType
     * @param {number} tradeSum
     *
     * @returns {boolean} success
     */
    static async moneyExchange(source, destination, tradeType, tradeSum = 0, options = {}) {
        const freeTradeTypes = ['loot', 'give'];
        let successfullTransaction = true;

        if (!freeTradeTypes.includes(tradeType)) {
            successfullTransaction = await this._updateFunds(source, destination, tradeSum, options);
        }

        return successfullTransaction;
    }

    /**
     *
     * @description
     * Check again if the source posses the item
     * If the source is not in possesion of the item anymore, remove it from the items array.
     *
     * If the source is in possession add its worth to the total tradesum.
     *
     * @param {Actor} source
     * @param {Collection} items
     * @param {object} options
     *
     * @returns {Array} [items, tradeSum]
     *
     * @author Daniel Böttner <@DanielBoettner>
     */
    static _prepareTrade(source, items, options = {}) {
        console.warn(options);
        const priceModifier = options.priceModifier || 100;
        let tradeSum = 0;
        for (const [key, item] of items.entries()) {
            if (!source.items.find(i => i.id == item.id)) {
                if (options?.verbose)
                    console.log(`${MODULE.ns} | _prepareTrade | Removed item "${item.name}" (id: ${item.id}) from trade. Item not found in inventory of the source actor.`);
                delete items[key];
                continue;
            }
            // Add item price to the total sum of the trade
            const originalItemPrice = item.data.data.price;
            tradeSum += this._getItemPriceInGold(originalItemPrice, 100, item.data.data.quantity);
            if (options?.verbose) console.info(`${MODULE.ns} | ${this._prepareTrade.name} | tradeSum updated to: `);
        }

        return { items: items, tradeSum: tradeSum };
    }

    /**
     * @summary Get the items price in gold
     *
     * @param {number} price
     * @param {number} priceModifier
     * @param {number} quantity - defaults to 1

     * @returns {number} price - a float with 5 decimals
     */
    static _getItemPriceInGold(price, priceModifier, quantity = 1) {
        return parseFloat(((price * priceModifier / 100) * quantity).toFixed(5));
    }

    /**
     *
     * @param {Actor} actor
     *
     * @returns {number}
     *
     */
    static _getPriceModifier(actor) {
        let priceModifier = { buy: 1, sell: 1, give: 1, loot: 1 },
            flagIsObject = (typeof actor.getFlag(MODULE.ns, MODULE.flags.priceModifier) === 'object');

        if (flagIsObject) {
            priceModifier = actor.getFlag(MODULE.ns, MODULE.flags.priceModifier);
        } else {
            priceModifier.sell = actor.getFlag(MODULE.ns, MODULE.flags.priceModifier) || 1;
        }
        
        for (let p in priceModifier) {
            priceModifier[p] = parseFloat(priceModifier[p]).toPrecision(2);
        }

        return priceModifier;
    }

    /**
     * @summary Check the buyers funds and transfer the funds if they are enough
     *
     * @param {Actor} seller
     * @param {Actor} buyer
     * @param {number} itemCostInGold
     *
     * @returns {boolean}
     *
     * @version 1.1.0
     *
     * @author Jan Ole Peek @jopeek
     * @author Daniel Böttner @DanielBoettner
     *
     * @returns {boolean} true if the transaction was successful
     */
    static async _updateFunds(seller, buyer, itemCostInGold, options = {}) {
        const rates = CurrencyHelper.getRates(),
            itemCost = {
                "pp": itemCostInGold * rates.pp,
                "gp": itemCostInGold,
                "ep": itemCostInGold * rates.ep,
                "sp": itemCostInGold * rates.sp,
                "cp": itemCostInGold * rates.cp
            };

            console.warn('updateFund itemCos', buyer.name, itemCost.gp);
        let buyerFunds = CurrencyHelper.handleActorCurrency(buyer.data.data.currency),
            sellerFunds = CurrencyHelper.handleActorCurrency(seller.data.data.currency),
            fundsAsPlatinum = {
                "buyer": this._getFundsAsPlatinum(buyerFunds, rates),
                "seller": this._getFundsAsPlatinum(sellerFunds, rates)
            };

        if (itemCost.pp > fundsAsPlatinum.buyer) {
            ItemHelper.errorMessageToActor(buyer, buyer.name + ` doesn't have enough funds to purchase an item for ${itemCost.gp}gp.`);
            return false;
        }

        let updatedFunds = this._getUpdatedFunds(buyerFunds, sellerFunds, itemCost, rates, fundsAsPlatinum);

        await seller.update({ data: { currency: updatedFunds.sellerFunds } });
        await buyer.update({ data: { currency: updatedFunds.buyerFunds } });

        return true;
    }

    /**
     *
     * @param {object} buyerFunds
     * @param {object} sellerFunds
     * @param {object} rates
     * @param {number} fundsAsPlatinum
     *
     * @returns {Array<object>} [buyerFunds, sellerFunds]
     *
     * @author Jan Ole Peek < @jopeek >
     * @author Daniel Böttner < @DanielBoettner >
     */
    static _getUpdatedFunds(buyerFunds, sellerFunds, itemCost, rates, fundsAsPlatinum) {
        if (game.settings.get(MODULE.ns, "convertCurrency")) {
            fundsAsPlatinum.buyer -= itemCost.pp;
            fundsAsPlatinum.seller += itemCost.pp;
            buyerFunds = this._updateConvertCurrency(buyerFunds, fundsAsPlatinum.buyer);
            sellerFunds = this._updateConvertCurrency(sellerFunds, fundsAsPlatinum.seller);
        } else {
            if (buyerFunds.gp >= itemCost.gp) {
                buyerFunds.gp -= itemCost.gp;
                sellerFunds.gp += itemCost.gp;
            } else {
                buyerFunds.pp -= itemCost.pp;
                sellerFunds.pp += itemCost.pp;
            }

            buyerFunds = this._smoothenFunds(buyerFunds, rates);
            sellerFunds = this._smoothenFunds(sellerFunds, rates);
        }
      
        return { buyerFunds: buyerFunds, sellerFunds: sellerFunds };
    }

    /**
     *
     * @param {object} itemCost
     *
     * @returns
     */
    findSmallestChange(itemCost) {
        let smallestChange = [];
        for (const [key, value] of Object.entries(itemCost)) {
            if (Number.isInteger(value)) {
                smallestChange[value] = key;
            }
        }
        return smallestChange.filter(x=>x!==undefined);
    }

    /**
     * @summary get the funds as platinum value
     *
     * @param {object} funds
     * @returns {string}
     *
     * @author Jan Ole Peek < @jopeek >
     * @version 1.0.0
     *
     */
    static _getFundsAsPlatinum(funds, rates) {
        let fundsAsPlatinum = funds.pp;

        fundsAsPlatinum += funds.gp * rates.pp;
        fundsAsPlatinum += (funds.ep / rates.gp) * rates.pp;
        fundsAsPlatinum += (funds.sp / rates.gp) * rates.pp;
        fundsAsPlatinum += (funds.cp / rates.gp) * rates.pp;
        
        console.log(`${MODULE.ns} | _getFundsAsPlatinum | funds: `, funds);
        console.log(`${MODULE.ns} | _getFundsAsPlatinum | fundsAsPlatinum: `, fundsAsPlatinum);
        return fundsAsPlatinum;
    }

    /**
     * @param {object}
     * @param {number} funds
     */
    static _updateConvertCurrency(funds, fundsAsPlatinum) {
        for (let currency in funds) {
            funds[currency] = 0; // Remove every coin we have
        }
        funds.pp = fundsAsPlatinum;

        return funds;
    }


    /**
     * @summary Take portions of a currency and add them as a integer to the next lower currency
     *
     * @param {object} funds
     * @param {object} compensation
     * @param {object} rates
     *
     * @returns {object}
     */
    static _smoothenFunds(funds, rates) {
        const compensation = { "pp": "gp", "gp": "ep", "ep": "sp", "sp": "cp" };

        for (let currency in funds) {
            let current = parseFloat(funds[currency].toFixed(5)),
                currentPart = parseFloat((current % 1).toFixed(5)),
                currentInt = ~~(Math.abs(current));

            funds[currency] = (currentInt > 0) ? currentInt : 0;

            if (currency != "cp") {
                // We calculate the amount of lower currency we get for the fraction of higher currency we have
                let change = (currency === 'pp') ? currentPart / rates[currency] : currentPart * rates[compensation[currency]];
                funds[compensation[currency]] += change;
            }
        }

        return funds;
    }
}
