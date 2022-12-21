import { BigInt, Address, Bytes } from "@graphprotocol/graph-ts";
import {
  Create,
  BufferBinaryOptions,
} from "../generated/BufferBinaryOptions/BufferBinaryOptions";
import { User, VolumePerContract } from "../generated/schema";
import { _getDayId, _getHourId } from "./helpers";
import {
  _loadOrCreateLeaderboardEntity,
  _loadOrCreateOptionContractEntity,
  _loadOrCreateOptionDataEntity,
  _loadOrCreateQueuedOptionEntity,
  _loadOrCreateVolumeStat,
  _loadOrCreateTradingStatEntity,
  _loadOrCreateFeeStat,
  _loadOrCreateUserStat,
  _loadOrCreateDashboardStat,
} from "./initialize";

function _logVolume(timestamp: BigInt, amount: BigInt): void {
  let totalEntity = _loadOrCreateVolumeStat("total", "total", timestamp);
  totalEntity.amount = totalEntity.amount.plus(amount);
  totalEntity.save();

  let id = _getDayId(timestamp);
  let dailyEntity = _loadOrCreateVolumeStat(id, "daily", timestamp);
  dailyEntity.amount = dailyEntity.amount.plus(amount);
  dailyEntity.save();

  let hourID = _getHourId(timestamp);
  let hourlyEntity = _loadOrCreateVolumeStat(hourID, "hourly", timestamp);
  hourlyEntity.amount = hourlyEntity.amount.plus(amount);
  hourlyEntity.save();
}

function _storeFees(timestamp: BigInt, fees: BigInt): void {
  let id = _getDayId(timestamp);
  let entity = _loadOrCreateFeeStat(id, "daily", timestamp);
  entity.fee = entity.fee.plus(fees);
  entity.save();

  let totalEntity = _loadOrCreateFeeStat("total", "total", timestamp);
  totalEntity.fee = totalEntity.fee.plus(fees);
  totalEntity.save();
}

function _logVolumePerContract(
  id: string,
  period: string,
  timestamp: BigInt,
  contractAddress: Bytes,
  depositToken: string,
  totalFee: BigInt,
  settlementFee: BigInt
): void {
  let referrenceID = `${id}${contractAddress}${depositToken}`;
  let entity = VolumePerContract.load(referrenceID);
  if (entity === null) {
    entity = new VolumePerContract(referrenceID);
    entity.period = period;
    entity.timestamp = timestamp;
    entity.amount = totalFee;
    entity.optionContract = contractAddress;
    entity.depositToken = depositToken;
    entity.settlementFee = settlementFee;
    entity.save();
  } else {
    entity.amount = entity.amount.plus(totalFee);
  }
}

export function logUser(timestamp: BigInt, account: Address): void {
  let user = User.load(account);
  if (user == null) {
    let totalUserStat = _loadOrCreateUserStat("total", "total", timestamp);
    totalUserStat.uniqueCountCumulative =
      totalUserStat.uniqueCountCumulative + 1;
    totalUserStat.save();

    let id = _getDayId(timestamp);
    let userStat = _loadOrCreateUserStat(id, "daily", timestamp);
    userStat.uniqueCount = userStat.uniqueCount + 1;
    userStat.save();

    user = new User(account);
    user.address = account;
    user.save();
  }
}

export function storePnl(
  timestamp: BigInt,
  pnl: BigInt,
  isProfit: boolean
): void {
  let totalEntity = _loadOrCreateTradingStatEntity("total", "total", timestamp);
  let dayID = _getDayId(timestamp);
  let dailyEntity = _loadOrCreateTradingStatEntity(dayID, "daily", timestamp);

  if (isProfit) {
    totalEntity.profitCumulative = totalEntity.profitCumulative.plus(pnl);
    dailyEntity.profit = dailyEntity.profit.plus(pnl);
  } else {
    totalEntity.lossCumulative = totalEntity.lossCumulative.plus(pnl);
    dailyEntity.loss = dailyEntity.loss.plus(pnl);
  }
  totalEntity.save();
  dailyEntity.profitCumulative = totalEntity.profitCumulative;
  dailyEntity.lossCumulative = totalEntity.lossCumulative;
  dailyEntity.save();
}

export function updateOpenInterest(
  timestamp: BigInt,
  increase: boolean,
  isAbove: boolean,
  totalFee: BigInt,
  contractAddress: Bytes
): void {
  let optionContractData = _loadOrCreateOptionContractEntity(contractAddress);
  optionContractData.tradeCount += 1;
  optionContractData.volume = optionContractData.volume.plus(totalFee);

  let totalId = "total";
  let totalEntity = _loadOrCreateTradingStatEntity(totalId, "total", timestamp);

  if (isAbove) {
    totalEntity.longOpenInterest = increase
      ? totalEntity.longOpenInterest.plus(totalFee)
      : totalEntity.longOpenInterest.minus(totalFee);
    optionContractData.openUp = increase
      ? optionContractData.openUp.plus(totalFee)
      : optionContractData.openUp.minus(totalFee);
  } else {
    totalEntity.shortOpenInterest = increase
      ? totalEntity.shortOpenInterest.plus(totalFee)
      : totalEntity.shortOpenInterest.minus(totalFee);
    optionContractData.openUp = increase
      ? optionContractData.openDown.plus(totalFee)
      : optionContractData.openDown.minus(totalFee);
  }
  totalEntity.save();
  optionContractData.save();

  let dayID = _getDayId(timestamp);
  let dailyEntity = _loadOrCreateTradingStatEntity(dayID, "daily", timestamp);
  dailyEntity.longOpenInterest = totalEntity.longOpenInterest;
  dailyEntity.shortOpenInterest = totalEntity.shortOpenInterest;
  dailyEntity.save();
}

export function _handleCreate(event: Create, tokenReferrenceID: string): void {
  let optionID = event.params.id;
  let timestamp = event.block.timestamp;
  let contractAddress = event.address;
  let optionData = BufferBinaryOptions.bind(contractAddress).options(optionID);
  let userOptionData = _loadOrCreateOptionDataEntity(optionID, contractAddress);
  userOptionData.user = event.params.account;
  userOptionData.totalFee = event.params.totalFee;
  userOptionData.state = optionData.value0;
  userOptionData.strike = optionData.value1;
  userOptionData.amount = optionData.value2;
  userOptionData.expirationTime = optionData.value5;
  userOptionData.isAbove = optionData.value6 ? true : false;
  userOptionData.creationTime = optionData.value8;
  userOptionData.settlementFee = event.params.settlementFee;
  userOptionData.depositToken = tokenReferrenceID;
  userOptionData.save();

  _logVolumePerContract(
    _getHourId(timestamp),
    "hourly",
    timestamp,
    contractAddress,
    tokenReferrenceID,
    event.params.totalFee,
    event.params.settlementFee
  );
  let leaderboardEntity = _loadOrCreateLeaderboardEntity(
    _getDayId(timestamp),
    event.params.account
  );
  leaderboardEntity.volume = leaderboardEntity.volume.plus(
    event.params.totalFee
  );
  leaderboardEntity.totalTrades = leaderboardEntity.totalTrades + 1;
  leaderboardEntity.save();

  if (tokenReferrenceID == "USDC") {
    let amount = optionData.value2.div(BigInt.fromI64(1000000));
    let totalFee = event.params.totalFee.div(BigInt.fromI64(1000000));
    let settlementFee = event.params.settlementFee.div(BigInt.fromI64(1000000));
    updateOpenInterest(
      timestamp,
      true,
      userOptionData.isAbove,
      amount,
      contractAddress
    );
    _storeFees(timestamp, settlementFee);
    _logVolume(timestamp, totalFee);
  }
  let dashboardStat = _loadOrCreateDashboardStat(tokenReferrenceID);
  dashboardStat.totalVolume = dashboardStat.totalVolume.plus(
    event.params.totalFee
  );
  dashboardStat.totalSettlementFees = dashboardStat.totalSettlementFees.plus(
    event.params.settlementFee
  );
  dashboardStat.totalTrades += 1;
  dashboardStat.save();
}
