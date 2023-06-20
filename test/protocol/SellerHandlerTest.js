const { ethers } = require("hardhat");
const { ZeroAddress, getContractAt, getSigners } = ethers;
const { expect, assert } = require("chai");
const Seller = require("../../scripts/domain/Seller");
const AuthToken = require("../../scripts/domain/AuthToken");
const AuthTokenType = require("../../scripts/domain/AuthTokenType");
const SellerUpdateFields = require("../../scripts/domain/SellerUpdateFields");
const PausableRegion = require("../../scripts/domain/PausableRegion.js");
const { RevertReasons } = require("../../scripts/config/revert-reasons.js");
const { calculateContractAddress, setupTestEnvironment, getSnapshot, revertToSnapshot } = require("../util/utils.js");
const { VOUCHER_NAME, VOUCHER_SYMBOL } = require("../util/constants");
const { deployMockTokens } = require("../../scripts/util/deploy-mock-tokens");
const { mockSeller, mockAuthToken, mockVoucherInitValues, accountId } = require("../util/mock");

/**
 *  Test the Boson Seller Handler
 */
describe("SellerHandler", function () {
  // Common vars
  let deployer,
    pauser,
    rando,
    assistant,
    admin,
    clerk,
    treasury,
    other1,
    other2,
    other3,
    other4,
    other5,
    other6,
    other7,
    authTokenOwner;
  let accountHandler, exchangeHandler, configHandler, pauseHandler;
  let seller,
    sellerStruct,
    seller2,
    seller3,
    seller4,
    expectedSeller,
    pendingSellerUpdate,
    pendingSellerUpdateStruct,
    pendingAuthToken,
    pendingAuthTokenStruct;
  let authToken, authTokenStruct, emptyAuthToken, emptyAuthTokenStruct, authToken2, authToken3;
  let key, value, exists;
  let bosonVoucher;
  let expectedCloneAddress;
  let voucherInitValues, contractURI;
  let mockAuthERC721Contract, mockAuthERC721Contract2;
  let snapshotId;

  before(async function () {
    // Reset the accountId iterator
    accountId.next(true);

    // Specify contracts needed for this test
    const contracts = {
      accountHandler: "IBosonAccountHandler",
      exchangeHandler: "IBosonExchangeHandler",
      pauseHandler: "IBosonPauseHandler",
      configHandler: "IBosonConfigHandler",
    };

    ({
      signers: [pauser, admin, treasury, rando, other1, other2, other3, other4, other5, other6, other7],
      contractInstances: { accountHandler, exchangeHandler, pauseHandler, configHandler },
    } = await setupTestEnvironment(contracts));

    // make all account the same
    authTokenOwner = assistant = admin;
    clerk = { address: ZeroAddress };
    [deployer] = await getSigners();

    // Deploy mock ERC721 tokens
    [mockAuthERC721Contract, mockAuthERC721Contract2] = await deployMockTokens(["Foreign721", "Foreign721"]);

    await expect(
      configHandler
        .connect(deployer)
        .setAuthTokenContract(AuthTokenType.Lens, await mockAuthERC721Contract.getAddress())
    )
      .to.emit(configHandler, "AuthTokenContractChanged")
      .withArgs(AuthTokenType.Lens, await mockAuthERC721Contract.getAddress(), await deployer.getAddress());

    await expect(
      configHandler
        .connect(deployer)
        .setAuthTokenContract(AuthTokenType.ENS, await mockAuthERC721Contract2.getAddress())
    )
      .to.emit(configHandler, "AuthTokenContractChanged")
      .withArgs(AuthTokenType.ENS, await mockAuthERC721Contract2.getAddress(), await deployer.getAddress());

    await mockAuthERC721Contract.connect(authTokenOwner).mint(8400, 1);

    // Get snapshot id
    snapshotId = await getSnapshot();
  });

  afterEach(async function () {
    await revertToSnapshot(snapshotId);
    snapshotId = await getSnapshot();
  });

  // All supported Seller methods
  context("📋 Seller Methods", async function () {
    beforeEach(async function () {
      // Create a valid seller, then set fields in tests directly

      seller = mockSeller(
        await assistant.getAddress(),
        await admin.getAddress(),
        clerk.address,
        await treasury.getAddress(),
        true,
        "https://ipfs.io/ipfs/originalUri"
      );
      expect(seller.isValid()).is.true;

      // How that seller looks as a returned struct
      sellerStruct = seller.toStruct();

      // VoucherInitValues
      contractURI = `https://ipfs.io/ipfs/QmW2WQi7j6c7UgJTarActp7tDNikE4B2qXtFCfLPdsgaTQ`;
      voucherInitValues = mockVoucherInitValues();
      expect(voucherInitValues.isValid()).is.true;

      // expected address of the first clone
      expectedCloneAddress = calculateContractAddress(await accountHandler.getAddress(), "1");

      // AuthTokens
      emptyAuthToken = mockAuthToken();
      expect(emptyAuthToken.isValid()).is.true;
      emptyAuthTokenStruct = emptyAuthToken.toStruct();

      authToken = new AuthToken("8400", AuthTokenType.Lens);
      expect(authToken.isValid()).is.true;
      authTokenStruct = authToken.toStruct();
    });

    afterEach(async function () {
      // Reset the accountId iterator
      accountId.next(true);
    });

    context("👉 createSeller()", async function () {
      it("should emit a SellerCreated event when auth token is empty", async function () {
        // Create a seller, testing for the event
        const tx = await accountHandler.connect(admin).createSeller(seller, emptyAuthToken, voucherInitValues);

        await expect(tx)
          .to.emit(accountHandler, "SellerCreated")
          .withArgs(seller.id, sellerStruct, expectedCloneAddress, emptyAuthTokenStruct, await admin.getAddress());

        // Voucher clone contract
        bosonVoucher = await getContractAt("IBosonVoucher", expectedCloneAddress);

        await expect(tx).to.emit(bosonVoucher, "ContractURIChanged").withArgs(contractURI);

        await expect(tx)
          .to.emit(bosonVoucher, "RoyaltyPercentageChanged")
          .withArgs(voucherInitValues.royaltyPercentage);

        await expect(tx)
          .to.emit(bosonVoucher, "VoucherInitialized")
          .withArgs(seller.id, voucherInitValues.royaltyPercentage, contractURI);

        bosonVoucher = await getContractAt("OwnableUpgradeable", expectedCloneAddress);

        await expect(tx)
          .to.emit(bosonVoucher, "OwnershipTransferred")
          .withArgs(ZeroAddress, await assistant.getAddress());
      });

      it("should emit a SellerCreated event when auth token is not empty", async function () {
        // Create a seller, testing for the event
        seller.admin = ZeroAddress;
        sellerStruct = seller.toStruct();
        const tx = await accountHandler.connect(authTokenOwner).createSeller(seller, authToken, voucherInitValues);

        await expect(tx)
          .to.emit(accountHandler, "SellerCreated")
          .withArgs(seller.id, sellerStruct, expectedCloneAddress, authTokenStruct, await authTokenOwner.getAddress());

        // Voucher clone contract
        bosonVoucher = await getContractAt("IBosonVoucher", expectedCloneAddress);

        await expect(tx).to.emit(bosonVoucher, "ContractURIChanged").withArgs(contractURI);

        await expect(tx)
          .to.emit(bosonVoucher, "RoyaltyPercentageChanged")
          .withArgs(voucherInitValues.royaltyPercentage);

        await expect(tx)
          .to.emit(bosonVoucher, "VoucherInitialized")
          .withArgs(seller.id, voucherInitValues.royaltyPercentage, contractURI);

        bosonVoucher = await getContractAt("OwnableUpgradeable", expectedCloneAddress);

        await expect(tx)
          .to.emit(bosonVoucher, "OwnershipTransferred")
          .withArgs(ZeroAddress, await assistant.getAddress());
      });

      it("should update state when authToken is empty", async function () {
        // Create a seller
        await accountHandler.connect(admin).createSeller(seller, emptyAuthToken, voucherInitValues);

        // Get the seller as a struct
        [, sellerStruct, emptyAuthTokenStruct] = await accountHandler.connect(rando).getSeller(seller.id);

        // Parse into entity
        let returnedSeller = Seller.fromStruct(sellerStruct);
        let returnedAuthToken = AuthToken.fromStruct(emptyAuthTokenStruct);

        // Returned values should match the input in createSeller
        for ([key, value] of Object.entries(seller)) {
          expect(JSON.stringify(returnedSeller[key]) === JSON.stringify(value)).is.true;
        }

        // Returned auth token values should match the input in createSeller
        for ([key, value] of Object.entries(emptyAuthToken)) {
          expect(JSON.stringify(returnedAuthToken[key]) === JSON.stringify(value)).is.true;
        }

        // Voucher clone contract
        bosonVoucher = await getContractAt("OwnableUpgradeable", expectedCloneAddress);

        expect(await bosonVoucher.owner()).to.equal(await assistant.getAddress(), "Wrong voucher clone owner");

        bosonVoucher = await getContractAt("IBosonVoucher", expectedCloneAddress);
        expect(await bosonVoucher.contractURI()).to.equal(contractURI, "Wrong contract URI");
        expect(await bosonVoucher.name()).to.equal(VOUCHER_NAME + " " + seller.id, "Wrong voucher client name");
        expect(await bosonVoucher.symbol()).to.equal(VOUCHER_SYMBOL + "_" + seller.id, "Wrong voucher client symbol");
      });

      it("should update state when voucherInitValues has zero royaltyPercentage and exchangeId does not exist", async function () {
        // ERC2981 Royalty fee is 0%
        voucherInitValues.royaltyPercentage = "0"; //0%
        expect(voucherInitValues.isValid()).is.true;

        // Create a seller
        await accountHandler.connect(admin).createSeller(seller, emptyAuthToken, voucherInitValues);

        bosonVoucher = await getContractAt("IBosonVoucher", expectedCloneAddress);
        expect(await bosonVoucher.contractURI()).to.equal(contractURI, "Wrong contract URI");
        expect(await bosonVoucher.name()).to.equal(VOUCHER_NAME + " " + seller.id, "Wrong voucher client name");
        expect(await bosonVoucher.symbol()).to.equal(VOUCHER_SYMBOL + "_" + seller.id, "Wrong voucher client symbol");

        // Prepare random parameters
        let exchangeId = "1234"; // An exchange id that does not exist
        let offerPrice = "1234567"; // A random offer price

        //Exchange exists
        let exists;
        [exists] = await exchangeHandler.connect(rando).getExchangeState(exchangeId);
        expect(exists).to.be.false;

        // Get Royalty Information for Exchange id i.e. Voucher token id
        let receiver, royaltyAmount;
        [receiver, royaltyAmount] = await bosonVoucher.connect(assistant).royaltyInfo(exchangeId, offerPrice);

        // Expectations
        let expectedRecipient = ZeroAddress; //expect zero address when exchange id does not exist
        let expectedRoyaltyAmount = "0"; // Zero Fee when exchange id does not exist

        assert.equal(receiver, expectedRecipient, "Recipient address is incorrect");
        assert.equal(royaltyAmount.toString(), expectedRoyaltyAmount, "Royalty amount is incorrect");
      });

      it("should update state when voucherInitValues has non zero royaltyPercentage and exchangeId does not exist", async function () {
        // ERC2981 Royalty fee is 10%
        voucherInitValues.royaltyPercentage = "1000"; //10%
        expect(voucherInitValues.isValid()).is.true;

        // Create a seller
        await accountHandler.connect(admin).createSeller(seller, emptyAuthToken, voucherInitValues);

        bosonVoucher = await getContractAt("IBosonVoucher", expectedCloneAddress);
        expect(await bosonVoucher.contractURI()).to.equal(contractURI, "Wrong contract URI");
        expect(await bosonVoucher.name()).to.equal(VOUCHER_NAME + " " + seller.id, "Wrong voucher client name");
        expect(await bosonVoucher.symbol()).to.equal(VOUCHER_SYMBOL + "_" + seller.id, "Wrong voucher client symbol");

        // Prepare random parameters
        let exchangeId = "1234"; // An exchange id that does not exist
        let offerPrice = "1234567"; // A random offer price

        //Exchange exists
        let exists;
        [exists] = await exchangeHandler.connect(rando).getExchangeState(exchangeId);
        expect(exists).to.be.false;

        // Get Royalty Information for Exchange id i.e. Voucher token id
        let receiver, royaltyAmount;
        [receiver, royaltyAmount] = await bosonVoucher.connect(assistant).royaltyInfo(exchangeId, offerPrice);

        // Expectations
        let expectedRecipient = ZeroAddress; //expect zero address when exchange id does not exist
        let expectedRoyaltyAmount = "0"; // Zero Fee when exchange id does not exist

        assert.equal(receiver, expectedRecipient, "Recipient address is incorrect");
        assert.equal(royaltyAmount.toString(), expectedRoyaltyAmount, "Royalty amount is incorrect");
      });

      it("should update state when authToken is not empty", async function () {
        seller.admin = ZeroAddress;

        // Create a seller
        await accountHandler.connect(authTokenOwner).createSeller(seller, authToken, voucherInitValues);

        // Get the seller as a struct
        [, sellerStruct, authTokenStruct] = await accountHandler.connect(rando).getSeller(seller.id);

        // Parse into entity
        let returnedSeller = Seller.fromStruct(sellerStruct);
        let returnedAuthToken = AuthToken.fromStruct(authTokenStruct);

        // Returned values should match the input in createSeller
        for ([key, value] of Object.entries(seller)) {
          expect(JSON.stringify(returnedSeller[key]) === JSON.stringify(value)).is.true;
        }

        // Returned auth token values should match the input in createSeller
        for ([key, value] of Object.entries(authToken)) {
          expect(JSON.stringify(returnedAuthToken[key]) === JSON.stringify(value)).is.true;
        }

        // Voucher clone contract
        bosonVoucher = await getContractAt("OwnableUpgradeable", expectedCloneAddress);

        expect(await bosonVoucher.owner()).to.equal(await assistant.getAddress(), "Wrong voucher clone owner");

        bosonVoucher = await getContractAt("IBosonVoucher", expectedCloneAddress);
        expect(await bosonVoucher.contractURI()).to.equal(contractURI, "Wrong contract URI");
        expect(await bosonVoucher.name()).to.equal(VOUCHER_NAME + " " + seller.id, "Wrong voucher client name");
        expect(await bosonVoucher.symbol()).to.equal(VOUCHER_SYMBOL + "_" + seller.id, "Wrong voucher client symbol");
      });

      it("should ignore any provided id and assign the next available", async function () {
        const sellerId = seller.id;
        seller.id = "444";

        // Create a seller, testing for the event
        await expect(accountHandler.connect(admin).createSeller(seller, emptyAuthToken, voucherInitValues))
          .to.emit(accountHandler, "SellerCreated")
          .withArgs(sellerId, sellerStruct, expectedCloneAddress, emptyAuthTokenStruct, await admin.getAddress());

        // wrong seller id should not exist
        [exists] = await accountHandler.connect(rando).getSeller(seller.id);
        expect(exists).to.be.false;

        // next seller id should exist
        [exists] = await accountHandler.connect(rando).getSeller(sellerId);
        expect(exists).to.be.true;
      });

      it("should be possible to use the same address for assistant, admin and treasury", async function () {
        seller.assistant = await other1.getAddress();
        seller.admin = await other1.getAddress();
        seller.clerk = ZeroAddress;
        seller.treasury = await other1.getAddress();

        //Create struct again with new addresses
        sellerStruct = seller.toStruct();

        // Create a seller, testing for the event
        await expect(accountHandler.connect(other1).createSeller(seller, emptyAuthToken, voucherInitValues))
          .to.emit(accountHandler, "SellerCreated")
          .withArgs(seller.id, sellerStruct, expectedCloneAddress, emptyAuthTokenStruct, await other1.getAddress());
      });

      it("should be possible to use non-unique treasury address", async function () {
        // Create a seller, testing for the event
        await expect(accountHandler.connect(admin).createSeller(seller, emptyAuthToken, voucherInitValues))
          .to.emit(accountHandler, "SellerCreated")
          .withArgs(seller.id, sellerStruct, expectedCloneAddress, emptyAuthTokenStruct, await admin.getAddress());

        seller.id = accountId.next().value;
        seller.assistant = await other1.getAddress();
        seller.admin = await other1.getAddress();

        //Create struct again with new addresses
        sellerStruct = seller.toStruct();

        // expected address of the first clone
        expectedCloneAddress = calculateContractAddress(await accountHandler.getAddress(), "2");

        // Create a seller, testing for the event
        await expect(accountHandler.connect(other1).createSeller(seller, emptyAuthToken, voucherInitValues))
          .to.emit(accountHandler, "SellerCreated")
          .withArgs(seller.id, sellerStruct, expectedCloneAddress, emptyAuthTokenStruct, await other1.getAddress());
      });

      it("every seller should get a different clone address", async function () {
        // Create a seller, testing for the event
        await expect(accountHandler.connect(admin).createSeller(seller, emptyAuthToken, voucherInitValues))
          .to.emit(accountHandler, "SellerCreated")
          .withArgs(seller.id, sellerStruct, expectedCloneAddress, emptyAuthTokenStruct, await admin.getAddress());

        // second seller
        expectedCloneAddress = calculateContractAddress(await accountHandler.getAddress(), "2");
        seller = mockSeller(
          await other1.getAddress(),
          await other1.getAddress(),
          ZeroAddress,
          await other1.getAddress()
        );

        // Create a seller, testing for the event
        await expect(accountHandler.connect(other1).createSeller(seller, emptyAuthToken, voucherInitValues))
          .to.emit(accountHandler, "SellerCreated")
          .withArgs(
            seller.id,
            seller.toStruct(),
            expectedCloneAddress,
            emptyAuthTokenStruct,
            await other1.getAddress()
          );
      });

      it("should be possible to create a seller with same auth token id but different type", async function () {
        // Set admin == zero address because seller will be created with auth token
        seller.admin = ZeroAddress;

        //Create struct again with new address
        sellerStruct = seller.toStruct();

        // Create a seller, testing for the event
        await expect(accountHandler.connect(authTokenOwner).createSeller(seller, authToken, voucherInitValues))
          .to.emit(accountHandler, "SellerCreated")
          .withArgs(seller.id, sellerStruct, expectedCloneAddress, authTokenStruct, await authTokenOwner.getAddress());

        seller.assistant = await other1.getAddress();

        // Update assistant address so we can create a seller with the same auth token id but different type
        const tx = await accountHandler.connect(authTokenOwner).updateSeller(seller, authToken);

        pendingSellerUpdate = seller.clone();
        pendingSellerUpdate.treasury = ZeroAddress;
        pendingSellerUpdate.active = false;
        pendingSellerUpdate.metadataUri = "";
        pendingSellerUpdate.id = "0";
        pendingSellerUpdateStruct = pendingSellerUpdate.toStruct();

        // No pending update auth token
        pendingAuthToken = authToken.clone();
        pendingAuthToken.tokenId = "0";
        pendingAuthToken.tokenType = 0;
        pendingAuthTokenStruct = pendingAuthToken.toStruct();

        await expect(tx)
          .to.emit(accountHandler, "SellerUpdatePending")
          .withArgs(seller.id, pendingSellerUpdateStruct, pendingAuthTokenStruct, await authTokenOwner.getAddress());

        sellerStruct = seller.toStruct();

        // Nothing pending left
        pendingSellerUpdate.assistant = ZeroAddress;
        pendingSellerUpdate.clerk = ZeroAddress;
        pendingSellerUpdateStruct = pendingSellerUpdate.toStruct();

        // Assistant address owner must approve the update
        await expect(
          await accountHandler.connect(other1).optInToSellerUpdate(seller.id, [SellerUpdateFields.Assistant])
        )
          .to.emit(accountHandler, "SellerUpdateApplied")
          .withArgs(
            seller.id,
            sellerStruct,
            pendingSellerUpdateStruct,
            authTokenStruct,
            pendingAuthTokenStruct,
            await other1.getAddress()
          );

        seller.id = accountId.next().value;
        seller.assistant = await authTokenOwner.getAddress();

        //Create struct again with new addresses
        sellerStruct = seller.toStruct();

        // Set different auth token type, keeping token Id the same
        authToken.tokenType = AuthTokenType.ENS;
        authTokenStruct = authToken.toStruct();

        // mint token on ens contract
        await mockAuthERC721Contract2.connect(authTokenOwner).mint(8400, 1);

        // expected address of the first clone
        expectedCloneAddress = calculateContractAddress(await accountHandler.getAddress(), "2");

        // Create a seller, testing for the event
        await expect(accountHandler.connect(authTokenOwner).createSeller(seller, authToken, voucherInitValues))
          .to.emit(accountHandler, "SellerCreated")
          .withArgs(seller.id, sellerStruct, expectedCloneAddress, authTokenStruct, await authTokenOwner.getAddress());
      });

      it("should be possible to create a seller with same auth token type but different id", async function () {
        // Set admin == zero address because seller will be created with auth token
        seller.admin = ZeroAddress;

        //Create struct again with new address
        sellerStruct = seller.toStruct();

        // Create a seller, testing for the event
        await expect(accountHandler.connect(authTokenOwner).createSeller(seller, authToken, voucherInitValues))
          .to.emit(accountHandler, "SellerCreated")
          .withArgs(seller.id, sellerStruct, expectedCloneAddress, authTokenStruct, await authTokenOwner.getAddress());

        seller.assistant = await other1.getAddress();

        pendingSellerUpdate = seller.clone();
        pendingSellerUpdate.id = "0";
        pendingSellerUpdate.treasury = ZeroAddress;
        pendingSellerUpdate.metadataUri = "";
        pendingSellerUpdate.active = false;
        pendingSellerUpdateStruct = pendingSellerUpdate.toStruct();

        // No pending update auth token
        pendingAuthToken = authToken.clone();
        pendingAuthToken.tokenId = "0";
        pendingAuthToken.tokenType = 0;
        pendingAuthTokenStruct = pendingAuthToken.toStruct();

        // Update assistant address so we can create a seller with the same auth token id but different type
        const tx = await accountHandler.connect(authTokenOwner).updateSeller(seller, authToken);

        await expect(tx)
          .to.emit(accountHandler, "SellerUpdatePending")
          .withArgs(seller.id, pendingSellerUpdateStruct, pendingAuthTokenStruct, await authTokenOwner.getAddress());

        // Nothing pending left
        pendingSellerUpdate.assistant = ZeroAddress;
        pendingSellerUpdate.clerk = ZeroAddress;
        pendingSellerUpdateStruct = pendingSellerUpdate.toStruct();

        sellerStruct = seller.toStruct();

        // Assistant address owner must approve the update
        await expect(accountHandler.connect(other1).optInToSellerUpdate(seller.id, [SellerUpdateFields.Assistant]))
          .to.emit(accountHandler, "SellerUpdateApplied")
          .withArgs(
            seller.id,
            sellerStruct,
            pendingSellerUpdateStruct,
            authTokenStruct,
            pendingAuthTokenStruct,
            await other1.getAddress()
          );

        const newAuthTokenOwner = rando;
        seller.id = accountId.next().value;
        seller.assistant = await newAuthTokenOwner.getAddress();

        //Create struct again with new addresses
        sellerStruct = seller.toStruct();

        // Set different token Id, keeping auth token type the same
        authToken.tokenId = "0";
        authTokenStruct = authToken.toStruct();

        // mint the token
        await mockAuthERC721Contract.connect(rando).mint(authToken.tokenId, 1);

        // expected address of the first clone
        expectedCloneAddress = calculateContractAddress(await accountHandler.getAddress(), "2");

        // Create a seller, testing for the event
        await expect(accountHandler.connect(rando).createSeller(seller, authToken, voucherInitValues))
          .to.emit(accountHandler, "SellerCreated")
          .withArgs(
            seller.id,
            sellerStruct,
            expectedCloneAddress,
            authTokenStruct,
            await newAuthTokenOwner.getAddress()
          );
      });

      context("💔 Revert Reasons", async function () {
        it("The sellers region of protocol is paused", async function () {
          // Pause the sellers region of the protocol
          await pauseHandler.connect(pauser).pause([PausableRegion.Sellers]);

          // Attempt to create a seller expecting revert
          await expect(
            accountHandler.connect(rando).createSeller(seller, emptyAuthToken, voucherInitValues)
          ).to.revertedWith(RevertReasons.REGION_PAUSED);
        });

        it("active is false", async function () {
          seller.active = false;

          // Attempt to Create a seller, expecting revert
          await expect(
            accountHandler.connect(rando).createSeller(seller, emptyAuthToken, voucherInitValues)
          ).to.revertedWith(RevertReasons.MUST_BE_ACTIVE);
        });

        it("addresses are not unique to this seller Id when address used for same role", async function () {
          // Create a seller
          await accountHandler.connect(admin).createSeller(seller, emptyAuthToken, voucherInitValues);

          // Update seller assistant
          seller.assistant = await other1.getAddress();
          await accountHandler.connect(admin).updateSeller(seller, emptyAuthToken);

          // Approve the update
          await accountHandler.connect(other1).optInToSellerUpdate(seller.id, [SellerUpdateFields.Assistant]);

          seller.admin = await other1.getAddress();

          // Attempt to Create a seller with non-unique assistant, expecting revert
          await expect(
            accountHandler.connect(other1).createSeller(seller, emptyAuthToken, voucherInitValues)
          ).to.revertedWith(RevertReasons.SELLER_ADDRESS_MUST_BE_UNIQUE);

          seller.admin = await admin.getAddress();
          seller.assistant = await assistant.getAddress();

          // Attempt to Create a seller with non-unique admin, expecting revert
          await expect(
            accountHandler.connect(admin).createSeller(seller, emptyAuthToken, voucherInitValues)
          ).to.revertedWith(RevertReasons.SELLER_ADDRESS_MUST_BE_UNIQUE);
        });

        it("addresses are not unique to this seller Id when address used for different role", async function () {
          // Create a seller
          await accountHandler.connect(admin).createSeller(seller, emptyAuthToken, voucherInitValues);

          // Update seller assistant
          seller.assistant = await other1.getAddress();
          await accountHandler.connect(admin).updateSeller(seller, emptyAuthToken);

          // Approve the update
          await accountHandler.connect(other1).optInToSellerUpdate(seller.id, [SellerUpdateFields.Assistant]);

          seller.admin = await other1.getAddress();

          // Attempt to Create a seller with non-unique assistant, expecting revert
          await expect(
            accountHandler.connect(other1).createSeller(seller, emptyAuthToken, voucherInitValues)
          ).to.revertedWith(RevertReasons.SELLER_ADDRESS_MUST_BE_UNIQUE);

          // Update seller admin
          seller.admin = await other3.getAddress();
          seller.assistant = await assistant.getAddress();

          await accountHandler.connect(admin).updateSeller(seller, emptyAuthToken);

          // Approve the update
          await accountHandler.connect(other3).optInToSellerUpdate(seller.id, [SellerUpdateFields.Admin]);
          await accountHandler.connect(assistant).optInToSellerUpdate(seller.id, [SellerUpdateFields.Assistant]);

          seller.assistant = await other3.getAddress();

          // Attempt to Create a seller with non-unique admin, expecting revert
          await expect(
            accountHandler.connect(other3).createSeller(seller, emptyAuthToken, voucherInitValues)
          ).to.revertedWith(RevertReasons.SELLER_ADDRESS_MUST_BE_UNIQUE);
        });

        it("addresses are not unique to this seller Id when address used for same role and the seller is created with auth token", async function () {
          // Create a seller
          seller.admin = await rando.getAddress();
          seller.assistant = await rando.getAddress();

          seller2 = mockSeller(
            await authTokenOwner.getAddress(),
            ZeroAddress,
            ZeroAddress,
            await authTokenOwner.getAddress()
          );

          await accountHandler.connect(rando).createSeller(seller, emptyAuthToken, voucherInitValues);

          // Update the seller, so assistant matches authTokenOwner
          seller.assistant = await authTokenOwner.getAddress();
          await accountHandler.connect(rando).updateSeller(seller, emptyAuthToken);

          // Approve the update
          await accountHandler.connect(authTokenOwner).optInToSellerUpdate(seller.id, [SellerUpdateFields.Assistant]);

          // Attempt to Create a seller with non-unique assistant, expecting revert
          await expect(
            accountHandler.connect(authTokenOwner).createSeller(seller2, authToken, voucherInitValues)
          ).to.revertedWith(RevertReasons.SELLER_ADDRESS_MUST_BE_UNIQUE);
        });

        it("admin address is NOT zero address and AuthTokenType is NOT None", async function () {
          // Attempt to Create a seller, expecting revert
          await expect(
            accountHandler.connect(authTokenOwner).createSeller(seller, authToken, voucherInitValues)
          ).to.revertedWith(RevertReasons.ADMIN_OR_AUTH_TOKEN);
        });

        it("admin address is zero address and AuthTokenType is None", async function () {
          seller.admin = ZeroAddress;

          // Attempt to Create a seller, expecting revert
          await expect(
            accountHandler.connect(rando).createSeller(seller, emptyAuthToken, voucherInitValues)
          ).to.revertedWith(RevertReasons.ADMIN_OR_AUTH_TOKEN);
        });

        it("authToken is not unique to this seller", async function () {
          // Set admin == zero address because seller will be created with auth token
          seller.admin = ZeroAddress;
          seller.assistant = await authTokenOwner.getAddress();

          // Create a seller
          await accountHandler.connect(authTokenOwner).createSeller(seller, authToken, voucherInitValues);

          // Attempt to Create a seller with non-unique authToken
          await expect(
            accountHandler.connect(authTokenOwner).createSeller(seller, authToken, voucherInitValues)
          ).to.revertedWith(RevertReasons.AUTH_TOKEN_MUST_BE_UNIQUE);
        });

        it("authTokenType is Custom", async function () {
          // Set admin == zero address because seller will be created with auth token
          seller.admin = ZeroAddress;

          authToken.tokenType = AuthTokenType.Custom;

          // Attempt to Create a seller with AuthTokenType == Custom, expecting revert
          await expect(
            accountHandler.connect(authTokenOwner).createSeller(seller, authToken, voucherInitValues)
          ).to.revertedWith(RevertReasons.INVALID_AUTH_TOKEN_TYPE);
        });

        it("Caller is not the supplied admin", async function () {
          seller.assistant = await rando.getAddress();

          // Attempt to Create a seller with admin not the same to caller address
          await expect(
            accountHandler.connect(rando).createSeller(seller, emptyAuthToken, voucherInitValues)
          ).to.revertedWith(RevertReasons.NOT_ADMIN);
        });

        it("Caller does not own supplied auth token", async function () {
          // Set admin == zero address because seller will be created with auth token
          seller.admin = ZeroAddress;
          seller.assistant = await rando.getAddress();

          // Attempt to Create a seller without owning the auth token
          await expect(
            accountHandler.connect(rando).createSeller(seller, authToken, voucherInitValues)
          ).to.revertedWith(RevertReasons.NOT_ADMIN);
        });

        it("Caller is not the supplied assistant", async function () {
          seller.admin = await rando.getAddress();

          // Attempt to Create a seller with assistant not the same to caller address
          await expect(
            accountHandler.connect(rando).createSeller(seller, emptyAuthToken, voucherInitValues)
          ).to.revertedWith(RevertReasons.NOT_ASSISTANT);
        });

        it("Clerk is not a zero address", async function () {
          seller.admin = await rando.getAddress();
          seller.assistant = await rando.getAddress();
          seller.clerk = await rando.getAddress();

          // Attempt to Create a seller with clerk not the same to caller address
          await expect(
            accountHandler.connect(rando).createSeller(seller, emptyAuthToken, voucherInitValues)
          ).to.revertedWith(RevertReasons.CLERK_DEPRECATED);
        });

        it("addresses are the zero address", async function () {
          seller.assistant = ZeroAddress;
          seller.treasury = ZeroAddress;

          // Attempt to update a seller, expecting revert
          await expect(
            accountHandler.connect(rando).createSeller(seller, emptyAuthToken, voucherInitValues)
          ).to.revertedWith(RevertReasons.INVALID_ADDRESS);
        });

        it("Assistant address is zero address", async function () {
          seller.assistant = ZeroAddress;

          // Attempt to Create a seller with assistant == zero address
          await expect(
            accountHandler.connect(authTokenOwner).createSeller(seller, emptyAuthToken, voucherInitValues)
          ).to.revertedWith(RevertReasons.INVALID_ADDRESS);
        });

        it("Treasury address is zero address", async function () {
          seller.treasury = ZeroAddress;

          // Attempt to Create a seller with treasury == zero address
          await expect(
            accountHandler.connect(authTokenOwner).createSeller(seller, emptyAuthToken, voucherInitValues)
          ).to.revertedWith(RevertReasons.INVALID_ADDRESS);
        });
      });
    });

    context("👉 getSeller()", async function () {
      beforeEach(async function () {
        // AuthTokens
        emptyAuthToken = mockAuthToken();
        expect(emptyAuthToken.isValid()).is.true;

        authToken = new AuthToken("8400", AuthTokenType.Lens);
        expect(authToken.isValid()).is.true;

        // Seller can have either admin address or auth token
        seller.admin = ZeroAddress;

        // Create a seller
        await accountHandler.connect(authTokenOwner).createSeller(seller, authToken, voucherInitValues);

        // Create a another seller
        seller2 = mockSeller(
          await other1.getAddress(),
          await other1.getAddress(),
          ZeroAddress,
          await other1.getAddress()
        );
        expect(seller2.isValid()).is.true;

        await accountHandler.connect(other1).createSeller(seller2, emptyAuthToken, voucherInitValues);
      });

      it("should return true for exists if seller is found", async function () {
        // Get the exists flag
        [exists] = await accountHandler.connect(rando).getSeller(seller.id);

        // Validate
        expect(exists).to.be.true;
      });

      it("should return false for exists if seller is not found", async function () {
        // Get the exists flag
        [exists] = await accountHandler.connect(rando).getSeller("666");

        // Validate
        expect(exists).to.be.false;
      });

      it("should return the details of the correct seller as a struct if found", async function () {
        // Get the seller as a struct
        [, sellerStruct, authTokenStruct] = await accountHandler.connect(rando).getSeller("1");

        // Parse into entity
        let returnedSeller = Seller.fromStruct(sellerStruct);
        let returnedAuthToken = AuthToken.fromStruct(authTokenStruct);

        // Returned values should match the input in createSeller
        for ([key, value] of Object.entries(seller)) {
          expect(JSON.stringify(returnedSeller[key]) === JSON.stringify(value)).is.true;
        }

        // Returned auth token values should match the input in createSeller
        for ([key, value] of Object.entries(authToken)) {
          expect(JSON.stringify(returnedAuthToken[key]) === JSON.stringify(value)).is.true;
        }
      });

      it("should return the details of the correct seller if seller has empty authToken", async function () {
        // Get the seller as a struct
        [, sellerStruct, emptyAuthTokenStruct] = await accountHandler.connect(rando).getSeller("2");

        // Parse into entity
        let returnedSeller = Seller.fromStruct(sellerStruct);
        let returnedAuthToken = AuthToken.fromStruct(emptyAuthTokenStruct);

        // Returned values should match the input in createSeller
        for ([key, value] of Object.entries(seller2)) {
          expect(JSON.stringify(returnedSeller[key]) === JSON.stringify(value)).is.true;
        }

        // Returned auth token values should match the input in createSeller
        for ([key, value] of Object.entries(emptyAuthToken)) {
          expect(JSON.stringify(returnedAuthToken[key]) === JSON.stringify(value)).is.true;
        }
      });
    });

    context("👉 getSellerByAddress()", async function () {
      beforeEach(async function () {
        // AuthTokens
        emptyAuthToken = mockAuthToken();
        expect(emptyAuthToken.isValid()).is.true;

        authToken = new AuthToken("8400", AuthTokenType.Lens);
        expect(authToken.isValid()).is.true;

        // Seller can have either admin address or auth token
        seller.admin = ZeroAddress;

        // Create a seller
        await accountHandler.connect(authTokenOwner).createSeller(seller, authToken, voucherInitValues);

        // Create a another seller
        seller2 = mockSeller(
          await other1.getAddress(),
          await other1.getAddress(),
          ZeroAddress,
          await other1.getAddress()
        );
        expect(seller2.isValid()).is.true;

        contractURI = `https://ipfs.io/ipfs/QmW2WQi7j6c7UgJTarActp7tDNikE4B2qXtFCfLPdsgaTQ`;

        await accountHandler.connect(other1).createSeller(seller2, emptyAuthToken, voucherInitValues);
      });

      afterEach(async function () {
        // Reset the accountId iterator
        accountId.next(true);
      });

      it("should return the correct seller when searching on assistant address", async function () {
        [exists, sellerStruct, authTokenStruct] = await accountHandler
          .connect(rando)
          .getSellerByAddress(await assistant.getAddress());

        expect(exists).is.true;

        // Parse into entity
        let returnedSeller = Seller.fromStruct(sellerStruct);
        let returnedAuthToken = AuthToken.fromStruct(authTokenStruct);

        // Returned values should match the input in createSeller
        for ([key, value] of Object.entries(seller)) {
          expect(JSON.stringify(returnedSeller[key]) === JSON.stringify(value)).is.true;
        }

        // Returned auth token values should match the input in createSeller
        for ([key, value] of Object.entries(authToken)) {
          expect(JSON.stringify(returnedAuthToken[key]) === JSON.stringify(value)).is.true;
        }
      });

      it("should return the correct seller when searching on admin address", async function () {
        [exists, sellerStruct, emptyAuthTokenStruct] = await accountHandler
          .connect(rando)
          .getSellerByAddress(await other1.getAddress());

        expect(exists).is.true;

        // Parse into entity
        let returnedSeller = Seller.fromStruct(sellerStruct);
        let returnedAuthToken = AuthToken.fromStruct(emptyAuthTokenStruct);

        // Returned values should match the input in createSeller
        for ([key, value] of Object.entries(seller2)) {
          expect(JSON.stringify(returnedSeller[key]) === JSON.stringify(value)).is.true;
        }

        // Returned auth token values should match the input in createSeller
        for ([key, value] of Object.entries(emptyAuthToken)) {
          expect(JSON.stringify(returnedAuthToken[key]) === JSON.stringify(value)).is.true;
        }
      });

      it("should return exists false and default values when searching on treasury address", async function () {
        [exists, sellerStruct, emptyAuthTokenStruct] = await accountHandler
          .connect(rando)
          .getSellerByAddress(await treasury.getAddress());

        expect(exists).is.false;

        // Parse into entity
        let returnedSeller = Seller.fromStruct(sellerStruct);
        let returnedAuthToken = AuthToken.fromStruct(emptyAuthTokenStruct);

        // Returned values should be the default value for it's data type
        for ([key, value] of Object.entries(returnedSeller)) {
          if (key != "active") {
            expect(value == 0).is.true || expect(value === ZeroAddress).is.true;
          } else {
            expect(value).is.false;
          }
        }

        // Returned auth token values should be empty/default values
        for ([key, value] of Object.entries(emptyAuthToken)) {
          expect(JSON.stringify(returnedAuthToken[key]) === JSON.stringify(value)).is.true;
        }
      });

      it("should return exists false and default values when searching on unassociated address", async function () {
        [exists, sellerStruct, emptyAuthTokenStruct] = await accountHandler
          .connect(rando)
          .getSellerByAddress(await deployer.getAddress());

        expect(exists).is.false;

        // Parse into entity
        let returnedSeller = Seller.fromStruct(sellerStruct);
        let returnedAuthToken = AuthToken.fromStruct(emptyAuthTokenStruct);

        // Returned values should be the default value for it's data type
        for ([key, value] of Object.entries(returnedSeller)) {
          if (key != "active") {
            expect(value == 0).is.true || expect(value === ZeroAddress).is.true;
          } else {
            expect(value).is.false;
          }
        }

        // Returned auth token values should be empty/default values
        for ([key, value] of Object.entries(emptyAuthToken)) {
          expect(JSON.stringify(returnedAuthToken[key]) === JSON.stringify(value)).is.true;
        }
      });

      it("should return exists false and default values when searching on admin address that is zero address", async function () {
        [exists, sellerStruct, emptyAuthTokenStruct] = await accountHandler
          .connect(rando)
          .getSellerByAddress(seller.admin);

        expect(exists).is.false;

        // Parse into entity
        let returnedSeller = Seller.fromStruct(sellerStruct);
        let returnedAuthToken = AuthToken.fromStruct(emptyAuthTokenStruct);

        // Returned values should be the default value for it's data type
        for ([key, value] of Object.entries(returnedSeller)) {
          if (key != "active") {
            expect(value == 0).is.true || expect(value === ZeroAddress).is.true;
          } else {
            expect(value).is.false;
          }
        }

        // Returned auth token values should be empty/default values
        for ([key, value] of Object.entries(emptyAuthToken)) {
          expect(JSON.stringify(returnedAuthToken[key]) === JSON.stringify(value)).is.true;
        }
      });

      it("should return exists false and default values when searching on zero address", async function () {
        [exists, sellerStruct, emptyAuthTokenStruct] = await accountHandler
          .connect(rando)
          .getSellerByAddress(ZeroAddress);

        expect(exists).is.false;

        // Parse into entity
        let returnedSeller = Seller.fromStruct(sellerStruct);
        let returnedAuthToken = AuthToken.fromStruct(emptyAuthTokenStruct);

        // Returned values should be the default value for it's data type
        for ([key, value] of Object.entries(returnedSeller)) {
          if (key != "active") {
            expect(value == 0).is.true || expect(value === ZeroAddress).is.true;
          } else {
            expect(value).is.false;
          }
        }

        // Returned auth token values should be empty/default values
        for ([key, value] of Object.entries(emptyAuthToken)) {
          expect(JSON.stringify(returnedAuthToken[key]) === JSON.stringify(value)).is.true;
        }
      });
    });

    context("👉 getSellerByAuthToken()", async function () {
      beforeEach(async function () {
        // AuthTokens
        emptyAuthToken = mockAuthToken();
        expect(emptyAuthToken.isValid()).is.true;

        authToken = new AuthToken("8400", AuthTokenType.Lens);
        expect(authToken.isValid()).is.true;

        authToken2 = new AuthToken("0", AuthTokenType.ENS);
        expect(authToken2.isValid()).is.true;

        // Seller can have either admin address or auth token
        seller.admin = ZeroAddress;

        // Create a seller
        await accountHandler.connect(authTokenOwner).createSeller(seller, authToken, voucherInitValues);

        // Create seller 2
        seller2 = mockSeller(
          await other1.getAddress(),
          await other1.getAddress(),
          ZeroAddress,
          await other1.getAddress()
        );
        expect(seller2.isValid()).is.true;

        contractURI = `https://ipfs.io/ipfs/QmW2WQi7j6c7UgJTarActp7tDNikE4B2qXtFCfLPdsgaTQ`;

        await accountHandler.connect(other1).createSeller(seller2, emptyAuthToken, voucherInitValues);

        // Create seller 3
        seller3 = mockSeller(await other5.getAddress(), ZeroAddress, ZeroAddress, await treasury.getAddress());
        expect(seller3.isValid()).is.true;

        contractURI = `https://ipfs.io/ipfs/QmPChd2hVbrJ6bfo3WBcTW4iZnpHm8TEzWkLHmLpXhF68A`;

        await mockAuthERC721Contract2.connect(other5).mint(authToken2.tokenId, 1);
        await accountHandler.connect(other5).createSeller(seller3, authToken2, voucherInitValues);
      });

      afterEach(async function () {
        // Reset the accountId iterator
        accountId.next(true);
      });

      it("should return the correct seller when searching on valid auth token", async function () {
        //Search on authToken
        [exists, sellerStruct, authTokenStruct] = await accountHandler.connect(rando).getSellerByAuthToken(authToken);

        expect(exists).is.true;

        // Parse into entity
        let returnedSeller = Seller.fromStruct(sellerStruct);
        let returnedAuthToken = AuthToken.fromStruct(authTokenStruct);

        // Returned values should match the input in createSeller
        for ([key, value] of Object.entries(seller)) {
          expect(JSON.stringify(returnedSeller[key]) === JSON.stringify(value)).is.true;
        }

        // Returned auth token values should match the input in createSeller
        for ([key, value] of Object.entries(authToken)) {
          expect(JSON.stringify(returnedAuthToken[key]) === JSON.stringify(value)).is.true;
        }

        //Search on authToken2
        [exists, sellerStruct, authTokenStruct] = await accountHandler.connect(rando).getSellerByAuthToken(authToken2);

        expect(exists).is.true;

        // Parse into entity
        returnedSeller = Seller.fromStruct(sellerStruct);
        returnedAuthToken = AuthToken.fromStruct(authTokenStruct);

        // Returned values should match the input in createSeller
        for ([key, value] of Object.entries(seller3)) {
          expect(JSON.stringify(returnedSeller[key]) === JSON.stringify(value)).is.true;
        }

        // Returned auth token values should match the input in createSeller
        for ([key, value] of Object.entries(authToken2)) {
          expect(JSON.stringify(returnedAuthToken[key]) === JSON.stringify(value)).is.true;
        }
      });

      it("should return the correct seller when two sellers have same auth token Id but different auth token type", async function () {
        //create seller with same auth token Id but different auth token type from seller 1
        authToken3 = new AuthToken("8400", AuthTokenType.ENS);
        expect(authToken3.isValid()).is.true;

        // Create seller 4
        seller4 = mockSeller(await rando.getAddress(), ZeroAddress, ZeroAddress, await treasury.getAddress());
        expect(seller4.isValid()).is.true;

        await mockAuthERC721Contract2.connect(rando).mint(authToken3.tokenId, 1);
        await accountHandler.connect(rando).createSeller(seller4, authToken3, voucherInitValues);

        //Search on authToken
        [exists, sellerStruct, authTokenStruct] = await accountHandler.connect(rando).getSellerByAuthToken(authToken);

        expect(exists).is.true;

        // Parse into entity
        let returnedSeller = Seller.fromStruct(sellerStruct);
        let returnedAuthToken = AuthToken.fromStruct(authTokenStruct);

        // Returned values should match the input in createSeller
        for ([key, value] of Object.entries(seller)) {
          expect(JSON.stringify(returnedSeller[key]) === JSON.stringify(value)).is.true;
        }

        // Returned auth token values should match the input in createSeller
        for ([key, value] of Object.entries(authToken)) {
          expect(JSON.stringify(returnedAuthToken[key]) === JSON.stringify(value)).is.true;
        }

        //Search on authToken3
        [exists, sellerStruct, authTokenStruct] = await accountHandler.connect(rando).getSellerByAuthToken(authToken3);

        expect(exists).is.true;

        // Parse into entity
        returnedSeller = Seller.fromStruct(sellerStruct);
        returnedAuthToken = AuthToken.fromStruct(authTokenStruct);

        // Returned values should match the input in createSeller
        for ([key, value] of Object.entries(seller4)) {
          expect(JSON.stringify(returnedSeller[key]) === JSON.stringify(value)).is.true;
        }

        // Returned auth token values should match the input in createSeller
        for ([key, value] of Object.entries(authToken3)) {
          expect(JSON.stringify(returnedAuthToken[key]) === JSON.stringify(value)).is.true;
        }
      });

      it("should return the correct seller when two sellers have same auth token type but different auth token id", async function () {
        //create seller with same auth token Id but different auth token type from seller 1
        authToken3 = new AuthToken("0", AuthTokenType.Lens);
        expect(authToken3.isValid()).is.true;

        // Create seller 4
        seller4 = mockSeller(await rando.getAddress(), ZeroAddress, ZeroAddress, await treasury.getAddress());
        expect(seller4.isValid()).is.true;

        await mockAuthERC721Contract.connect(rando).mint(authToken3.tokenId, 1);
        await accountHandler.connect(rando).createSeller(seller4, authToken3, voucherInitValues);

        //Search on authToken
        [exists, sellerStruct, authTokenStruct] = await accountHandler.connect(rando).getSellerByAuthToken(authToken);

        expect(exists).is.true;

        // Parse into entity
        let returnedSeller = Seller.fromStruct(sellerStruct);
        let returnedAuthToken = AuthToken.fromStruct(authTokenStruct);

        // Returned values should match the input in createSeller
        for ([key, value] of Object.entries(seller)) {
          expect(JSON.stringify(returnedSeller[key]) === JSON.stringify(value)).is.true;
        }

        // Returned auth token values should match the input in createSeller
        for ([key, value] of Object.entries(authToken)) {
          expect(JSON.stringify(returnedAuthToken[key]) === JSON.stringify(value)).is.true;
        }

        //Search on authToken3
        [exists, sellerStruct, authTokenStruct] = await accountHandler.connect(rando).getSellerByAuthToken(authToken3);

        expect(exists).is.true;

        // Parse into entity
        returnedSeller = Seller.fromStruct(sellerStruct);
        returnedAuthToken = AuthToken.fromStruct(authTokenStruct);

        // Returned values should match the input in createSeller
        for ([key, value] of Object.entries(seller4)) {
          expect(JSON.stringify(returnedSeller[key]) === JSON.stringify(value)).is.true;
        }

        // Returned auth token values should match the input in createSeller
        for ([key, value] of Object.entries(authToken3)) {
          expect(JSON.stringify(returnedAuthToken[key]) === JSON.stringify(value)).is.true;
        }
      });

      it("should return exists false and default values when searching on empty auth token", async function () {
        [exists, sellerStruct, emptyAuthTokenStruct] = await accountHandler
          .connect(rando)
          .getSellerByAuthToken(emptyAuthToken);

        expect(exists).is.false;

        // Parse into entity
        let returnedSeller = Seller.fromStruct(sellerStruct);
        let returnedAuthToken = AuthToken.fromStruct(emptyAuthTokenStruct);

        // Returned values should be the default value for it's data type
        for ([key, value] of Object.entries(returnedSeller)) {
          if (key != "active") {
            expect(value == 0).is.true || expect(value === ZeroAddress).is.true;
          } else {
            expect(value).is.false;
          }
        }

        // Returned auth token values should be empty/default values
        for ([key, value] of Object.entries(emptyAuthToken)) {
          expect(JSON.stringify(returnedAuthToken[key]) === JSON.stringify(value)).is.true;
        }
      });
    });

    context("👉 updateSeller()", async function () {
      beforeEach(async function () {
        pendingSellerUpdate = seller.clone();
        pendingSellerUpdate.id = "0";
        pendingSellerUpdate.treasury = ZeroAddress;
        pendingSellerUpdate.clerk = ZeroAddress;
        pendingSellerUpdate.admin = ZeroAddress;
        pendingSellerUpdate.assistant = ZeroAddress;
        pendingSellerUpdate.active = false;
        pendingSellerUpdate.metadataUri = "";
        pendingSellerUpdateStruct = pendingSellerUpdate.toStruct();

        // Create a seller
        await accountHandler.connect(admin).createSeller(seller, emptyAuthToken, voucherInitValues);
      });

      it("should emit a SellerUpdateApplied and OwnershipTransferred event with correct values if values change", async function () {
        seller.treasury = await other4.getAddress();
        seller.metadataUri = "https://ipfs.io/ipfs/updatedUri";
        // Treasury and metadataURI are only values that can be update without address owner authorization
        sellerStruct = seller.toStruct();

        seller.admin = ZeroAddress;
        seller.assistant = await other1.getAddress();
        expect(seller.isValid()).is.true;

        pendingSellerUpdate = seller.clone();
        pendingSellerUpdate.id = "0";
        pendingSellerUpdate.treasury = ZeroAddress;
        pendingSellerUpdate.metadataUri = "";
        pendingSellerUpdate.active = false;
        expect(pendingSellerUpdate.isValid()).is.true;
        pendingSellerUpdateStruct = pendingSellerUpdate.toStruct();

        pendingAuthToken = authToken;
        pendingAuthTokenStruct = pendingAuthToken.toStruct();

        // Update seller
        let tx = await accountHandler.connect(admin).updateSeller(seller, authToken);

        // Testing for the SellerUpdateApplied event
        await expect(tx)
          .to.emit(accountHandler, "SellerUpdateApplied")
          .withArgs(
            seller.id,
            sellerStruct,
            pendingSellerUpdateStruct,
            emptyAuthTokenStruct,
            pendingAuthTokenStruct,
            await admin.getAddress()
          );

        // Testing for the SellerUpdatePending event
        await expect(tx)
          .to.emit(accountHandler, "SellerUpdatePending")
          .withArgs(seller.id, pendingSellerUpdateStruct, pendingAuthTokenStruct, await admin.getAddress());

        // Update seller assistant
        tx = await accountHandler.connect(other1).optInToSellerUpdate(seller.id, [SellerUpdateFields.Assistant]);

        // Voucher clone contract
        const bosonVoucherCloneAddress = calculateContractAddress(await exchangeHandler.getAddress(), "1");
        bosonVoucher = await getContractAt("OwnableUpgradeable", bosonVoucherCloneAddress);

        await expect(tx)
          .to.emit(bosonVoucher, "OwnershipTransferred")
          .withArgs(await assistant.getAddress(), await other1.getAddress());

        pendingSellerUpdate.assistant = ZeroAddress;
        pendingSellerUpdateStruct = pendingSellerUpdate.toStruct();
        seller.admin = await admin.getAddress();
        sellerStruct = seller.toStruct();

        // Check assistant update
        await expect(tx)
          .to.emit(accountHandler, "SellerUpdateApplied")
          .withArgs(
            seller.id,
            sellerStruct,
            pendingSellerUpdateStruct,
            emptyAuthTokenStruct,
            pendingAuthTokenStruct,
            await other1.getAddress()
          );

        // Update seller auth token
        tx = await accountHandler
          .connect(authTokenOwner)
          .optInToSellerUpdate(seller.id, [SellerUpdateFields.AuthToken]);

        pendingAuthToken = emptyAuthToken;
        pendingAuthTokenStruct = pendingAuthToken.toStruct();
        seller.admin = ZeroAddress;
        sellerStruct = seller.toStruct();

        // Check auth token update
        await expect(tx)
          .to.emit(accountHandler, "SellerUpdateApplied")
          .withArgs(
            seller.id,
            sellerStruct,
            pendingSellerUpdateStruct,
            authTokenStruct,
            pendingAuthTokenStruct,
            await authTokenOwner.getAddress()
          );
      });

      it("should only emit SellerUpdatePending event if no update has been immediately applied", async function () {
        seller.assistant = await other1.getAddress();
        const tx = await accountHandler.connect(admin).updateSeller(seller, emptyAuthToken);

        // SellerUpdateApplied should not be emit because no value has immediately updated
        await expect(tx).to.not.emit(accountHandler, "SellerUpdateApplied");

        // Voucher clone contract
        const bosonVoucherCloneAddress = calculateContractAddress(await exchangeHandler.getAddress(), "1");
        bosonVoucher = await getContractAt("OwnableUpgradeable", bosonVoucherCloneAddress);

        // Since assistant stayed the same yet, clone contract ownership should not be transferred immediately
        await expect(tx).to.not.emit(bosonVoucher, "OwnershipTransferred");

        // Only event emitted was SellerUpdatePending
        await expect(tx).to.emit(accountHandler, "SellerUpdatePending");
      });

      it("should update state of all fields except Id and active flag", async function () {
        seller.assistant = await other1.getAddress();
        seller.admin = ZeroAddress;
        seller.treasury = await other4.getAddress();
        seller.active = false;

        //Update should not change id or active flag
        expectedSeller = seller.clone();
        expectedSeller.active = true;
        expect(expectedSeller.isValid()).is.true;

        // Update a seller
        await accountHandler.connect(admin).updateSeller(seller, authToken);

        // Approve assistant update
        await accountHandler.connect(other1).optInToSellerUpdate(seller.id, [SellerUpdateFields.Assistant]);

        // Approve auth token update
        await accountHandler.connect(authTokenOwner).optInToSellerUpdate(seller.id, [SellerUpdateFields.AuthToken]);

        // Get the seller as a struct
        [, sellerStruct, authTokenStruct] = await accountHandler.connect(rando).getSeller(seller.id);

        // Parse into entity
        let returnedSeller = Seller.fromStruct(sellerStruct);
        let returnedAuthToken = AuthToken.fromStruct(authTokenStruct);

        // Returned values should match the expected values
        for ([key, value] of Object.entries(expectedSeller)) {
          expect(JSON.stringify(returnedSeller[key]) === JSON.stringify(value)).is.true;
        }

        // Returned auth token values should match the input in updateSeller
        for ([key, value] of Object.entries(authToken)) {
          expect(JSON.stringify(returnedAuthToken[key]) === JSON.stringify(value)).is.true;
        }

        //Check that old addresses are no longer mapped. We don't map the treasury address.
        [exists] = await accountHandler.connect(rando).getSellerByAddress(await assistant.getAddress());
        expect(exists).to.be.false;

        [exists] = await accountHandler.connect(rando).getSellerByAddress(await admin.getAddress());
        expect(exists).to.be.false;

        //Check that new addresses are mapped. We don't map the treasury address.
        [exists] = await accountHandler.connect(rando).getSellerByAddress(seller.assistant);
        expect(exists).to.be.true;

        //Zero address -- should return false
        [exists] = await accountHandler.connect(rando).getSellerByAddress(seller.admin);
        expect(exists).to.be.false;

        // Voucher clone contract
        const bosonVoucherCloneAddress = calculateContractAddress(await exchangeHandler.getAddress(), "1");
        bosonVoucher = await getContractAt("OwnableUpgradeable", bosonVoucherCloneAddress);

        expect(await bosonVoucher.owner()).to.equal(seller.assistant, "Wrong voucher clone owner");
      });

      it("should update state from auth token to empty auth token", async function () {
        seller2 = mockSeller(await other1.getAddress(), ZeroAddress, ZeroAddress, await other1.getAddress());
        expect(seller2.isValid()).is.true;

        // msg.sender must be equal to seller's assistant
        await mockAuthERC721Contract
          .connect(authTokenOwner)
          .transferFrom(await authTokenOwner.getAddress(), await other1.getAddress(), 8400);
        const newAuthTokenOwner = other1;

        // Create a seller with auth token
        await accountHandler.connect(newAuthTokenOwner).createSeller(seller2, authToken, voucherInitValues);

        seller2.assistant = await other5.getAddress();
        seller2.admin = await other6.getAddress();
        seller2.treasury = await other7.getAddress();
        seller2.active = false;

        //Update should not change id or active flag
        expectedSeller = seller2.clone();
        expectedSeller.active = true;
        expect(expectedSeller.isValid()).is.true;

        // Update seller
        await accountHandler.connect(newAuthTokenOwner).updateSeller(seller2, emptyAuthToken);

        // Approve assistant update
        await accountHandler.connect(other5).optInToSellerUpdate(seller2.id, [SellerUpdateFields.Assistant]);

        // Approve admin update
        await accountHandler.connect(other6).optInToSellerUpdate(seller2.id, [SellerUpdateFields.Admin]);

        // Get the seller as a struct
        [, sellerStruct, authTokenStruct] = await accountHandler.connect(rando).getSeller(seller2.id);

        // Parse into entity
        let returnedSeller = Seller.fromStruct(sellerStruct);
        let returnedAuthToken = AuthToken.fromStruct(authTokenStruct);

        // Returned values should match the expected values
        for ([key, value] of Object.entries(expectedSeller)) {
          expect(JSON.stringify(returnedSeller[key]) === JSON.stringify(value)).is.true;
        }

        // Returned auth token values should match the input in updateSeller
        for ([key, value] of Object.entries(emptyAuthToken)) {
          expect(JSON.stringify(returnedAuthToken[key]) === JSON.stringify(value)).is.true;
        }

        //Check that old addresses are no longer mapped. We don't map the treasury address.
        [exists] = await accountHandler.connect(rando).getSellerByAddress(await other1.getAddress());
        expect(exists).to.be.false;

        [exists] = await accountHandler.connect(rando).getSellerByAddress(ZeroAddress);
        expect(exists).to.be.false;

        [exists] = await accountHandler.connect(rando).getSellerByAddress(await other3.getAddress());
        expect(exists).to.be.false;

        //Check that new addresses are mapped. We don't map the treasury address.
        [exists] = await accountHandler.connect(rando).getSellerByAddress(seller2.assistant);
        expect(exists).to.be.true;

        [exists] = await accountHandler.connect(rando).getSellerByAddress(seller2.admin);
        expect(exists).to.be.true;

        // Voucher clone contract
        const bosonVoucherCloneAddress = calculateContractAddress(await exchangeHandler.getAddress(), "1");
        bosonVoucher = await getContractAt("OwnableUpgradeable", bosonVoucherCloneAddress);

        expect(await bosonVoucher.owner()).to.equal(seller.assistant, "Wrong voucher clone owner");
      });

      it("should update state from auth token to new auth token", async function () {
        seller2 = mockSeller(await other1.getAddress(), ZeroAddress, ZeroAddress, await other1.getAddress());
        expect(seller2.isValid()).is.true;

        // msg.sender must be equal to seller's assistant
        await mockAuthERC721Contract
          .connect(authTokenOwner)
          .transferFrom(await authTokenOwner.getAddress(), await other1.getAddress(), 8400);
        const newAuthTokenOwner = other1;

        // Create a seller with auth token
        await accountHandler.connect(newAuthTokenOwner).createSeller(seller2, authToken, voucherInitValues);

        seller2.assistant = await other5.getAddress();
        seller2.admin = ZeroAddress;
        seller2.treasury = await other7.getAddress();
        seller2.active = false;

        await mockAuthERC721Contract2.connect(newAuthTokenOwner).mint(0, 1);

        authToken2 = new AuthToken("0", AuthTokenType.ENS);
        expect(authToken2.isValid()).is.true;

        //Update should not change id or active flag
        expectedSeller = seller2.clone();
        expectedSeller.active = true;
        expect(expectedSeller.isValid()).is.true;

        // Update seller
        await accountHandler.connect(newAuthTokenOwner).updateSeller(seller2, authToken2);

        await accountHandler.connect(other5).optInToSellerUpdate(seller2.id, [SellerUpdateFields.Assistant]);
        await accountHandler.connect(newAuthTokenOwner).optInToSellerUpdate(seller2.id, [SellerUpdateFields.AuthToken]);

        // Get the seller as a struct
        [, sellerStruct, authTokenStruct] = await accountHandler.connect(rando).getSeller(seller2.id);

        // Parse into entity
        let returnedSeller = Seller.fromStruct(sellerStruct);
        let returnedAuthToken = AuthToken.fromStruct(authTokenStruct);

        // Returned values should match the expected values
        for ([key, value] of Object.entries(expectedSeller)) {
          expect(JSON.stringify(returnedSeller[key]) === JSON.stringify(value)).is.true;
        }

        // Returned auth token values should match the input in updateSeller
        for ([key, value] of Object.entries(authToken2)) {
          expect(JSON.stringify(returnedAuthToken[key]) === JSON.stringify(value)).is.true;
        }

        //Check that old addresses are no longer mapped. We don't map the treasury address.
        [exists] = await accountHandler.connect(rando).getSellerByAddress(await other1.getAddress());
        expect(exists).to.be.false;

        [exists] = await accountHandler.connect(rando).getSellerByAddress(ZeroAddress);
        expect(exists).to.be.false;

        [exists] = await accountHandler.connect(rando).getSellerByAddress(await other3.getAddress());
        expect(exists).to.be.false;

        //Check that new addresses are mapped. We don't map the treasury address.
        [exists] = await accountHandler.connect(rando).getSellerByAddress(seller2.assistant);
        expect(exists).to.be.true;

        [exists] = await accountHandler.connect(rando).getSellerByAddress(seller2.admin);
        expect(exists).to.be.false;

        // Voucher clone contract
        const bosonVoucherCloneAddress = calculateContractAddress(await exchangeHandler.getAddress(), "1");
        bosonVoucher = await getContractAt("OwnableUpgradeable", bosonVoucherCloneAddress);

        expect(await bosonVoucher.owner()).to.equal(seller.assistant, "Wrong voucher clone owner");
      });

      it("should update only one address", async function () {
        seller.assistant = await other1.getAddress();

        sellerStruct = seller.toStruct();

        // Update a seller
        await accountHandler.connect(admin).updateSeller(seller, emptyAuthToken);

        // Approve update
        await accountHandler.connect(other1).optInToSellerUpdate(seller.id, [SellerUpdateFields.Assistant]);

        // Get the seller as a struct
        [, sellerStruct, authTokenStruct] = await accountHandler.connect(rando).getSeller(seller.id);

        // Parse into entity
        let returnedSeller = Seller.fromStruct(sellerStruct);
        let returnedAuthToken = AuthToken.fromStruct(authTokenStruct);

        // Returned values should match the input in updateSeller
        for ([key, value] of Object.entries(seller)) {
          expect(JSON.stringify(returnedSeller[key]) === JSON.stringify(value)).is.true;
        }

        // Returned auth token values should match the input in updateSeller
        for ([key, value] of Object.entries(emptyAuthToken)) {
          expect(JSON.stringify(returnedAuthToken[key]) === JSON.stringify(value)).is.true;
        }
      });

      it("should update the correct seller", async function () {
        // Configure another seller
        seller2 = mockSeller(await other1.getAddress(), ZeroAddress, ZeroAddress, await other1.getAddress());
        expect(seller2.isValid()).is.true;

        contractURI = `https://ipfs.io/ipfs/QmW2WQi7j6c7UgJTarActp7tDNikE4B2qXtFCfLPdsgaTQ`;

        // msg.sender must be equal to seller's assistant
        let authTokenOwner = other1;
        await mockAuthERC721Contract.connect(authTokenOwner).mint(8500, 1);

        //Seller2  auth token
        authToken2 = new AuthToken("8500", AuthTokenType.Lens);

        //Create seller2
        await accountHandler.connect(authTokenOwner).createSeller(seller2, authToken2, voucherInitValues);

        //Update seller2
        seller2.assistant = await rando.getAddress();
        seller2.admin = ZeroAddress;
        seller2.treasury = await rando.getAddress();
        seller2.active = false;

        //Update should not change id or active flag
        expectedSeller = seller2.clone();
        expectedSeller.active = true;
        expect(expectedSeller.isValid()).is.true;

        //Seller2 specified wrong token Id in create. Update to correct one now
        authToken2.tokenId = "8400";

        // Update seller2
        await accountHandler.connect(authTokenOwner).updateSeller(seller2, authToken2);

        // Approve update
        await accountHandler.connect(rando).optInToSellerUpdate(seller2.id, [SellerUpdateFields.Assistant]);

        // Approve auth token update
        authTokenOwner = assistant;
        await accountHandler.connect(authTokenOwner).optInToSellerUpdate(seller2.id, [SellerUpdateFields.AuthToken]);

        // Check first seller hasn't changed
        [, sellerStruct, authTokenStruct] = await accountHandler.connect(rando).getSeller(seller.id);

        // Parse into entity
        let returnedSeller = Seller.fromStruct(sellerStruct);
        let returnedAuthToken = AuthToken.fromStruct(authTokenStruct);

        // returnedSeller should still contain original values
        for ([key, value] of Object.entries(seller)) {
          expect(JSON.stringify(returnedSeller[key]) === JSON.stringify(value)).is.true;
        }

        // returnedAuthToken should still contain original values
        for ([key, value] of Object.entries(emptyAuthToken)) {
          expect(JSON.stringify(returnedAuthToken[key]) === JSON.stringify(value)).is.true;
        }

        // Check seller2 HAS changed
        [, sellerStruct, authTokenStruct] = await accountHandler.connect(rando).getSeller(seller2.id);

        // Parse into entity
        let returnedSeller2 = Seller.fromStruct(sellerStruct);
        let returnedAuthToken2 = AuthToken.fromStruct(authTokenStruct);

        // returnedSeller2 should contain new values
        for ([key, value] of Object.entries(expectedSeller)) {
          expect(JSON.stringify(returnedSeller2[key]) === JSON.stringify(value)).is.true;
        }

        // returnedAuthToken2 should contain new values
        for ([key, value] of Object.entries(authToken2)) {
          expect(JSON.stringify(returnedAuthToken2[key]) === JSON.stringify(value)).is.true;
        }
      });

      it("should be able to only update with new admin address", async function () {
        seller.admin = await other2.getAddress();
        sellerStruct = seller.toStruct();
        pendingSellerUpdate.admin = await other2.getAddress();
        pendingSellerUpdateStruct = pendingSellerUpdate.toStruct();

        // Update seller
        let tx = await accountHandler.connect(admin).updateSeller(seller, emptyAuthToken);

        // Testing for the SellerUpdatePending event
        await expect(tx)
          .to.emit(accountHandler, "SellerUpdatePending")
          .withArgs(seller.id, pendingSellerUpdateStruct, emptyAuthTokenStruct, await admin.getAddress());

        pendingSellerUpdate.admin = ZeroAddress;
        pendingSellerUpdateStruct = pendingSellerUpdate.toStruct();

        // Approve update
        await expect(accountHandler.connect(other2).optInToSellerUpdate(seller.id, [SellerUpdateFields.Admin]))
          .to.emit(accountHandler, "SellerUpdateApplied")
          .withArgs(
            seller.id,
            sellerStruct,
            pendingSellerUpdateStruct,
            emptyAuthTokenStruct,
            emptyAuthTokenStruct,
            await other2.getAddress()
          );

        seller.admin = await other3.getAddress();
        sellerStruct = seller.toStruct();
        pendingSellerUpdate.admin = await other3.getAddress();
        pendingSellerUpdateStruct = pendingSellerUpdate.toStruct();

        // Update seller
        tx = await accountHandler.connect(other2).updateSeller(seller, emptyAuthToken);

        // Testing for the SellerUpdatePending event
        await expect(tx)
          .to.emit(accountHandler, "SellerUpdatePending")
          .withArgs(seller.id, pendingSellerUpdateStruct, emptyAuthTokenStruct, await other2.getAddress());

        pendingSellerUpdate.admin = ZeroAddress;
        pendingSellerUpdateStruct = pendingSellerUpdate.toStruct();

        // Approve update
        await expect(accountHandler.connect(other3).optInToSellerUpdate(seller.id, [SellerUpdateFields.Admin]))
          .to.emit(accountHandler, "SellerUpdateApplied")
          .withArgs(
            seller.id,
            sellerStruct,
            pendingSellerUpdateStruct,
            emptyAuthTokenStruct,
            emptyAuthTokenStruct,
            await other3.getAddress()
          );

        // Attempt to update the seller with original admin address, expecting revert
        await expect(accountHandler.connect(admin).updateSeller(seller, emptyAuthToken)).to.revertedWith(
          RevertReasons.NOT_ADMIN
        );
      });

      it("should be able to only update with new auth token", async function () {
        seller.admin = ZeroAddress;
        sellerStruct = seller.toStruct();

        // Update seller, testing for the event
        await expect(accountHandler.connect(admin).updateSeller(seller, authToken))
          .to.emit(accountHandler, "SellerUpdatePending")
          .withArgs(seller.id, pendingSellerUpdateStruct, authTokenStruct, await admin.getAddress());

        // Approve update
        await expect(
          accountHandler.connect(authTokenOwner).optInToSellerUpdate(seller.id, [SellerUpdateFields.AuthToken])
        )
          .to.emit(accountHandler, "SellerUpdateApplied")
          .withArgs(
            seller.id,
            sellerStruct,
            pendingSellerUpdateStruct,
            authTokenStruct,
            emptyAuthTokenStruct,
            await authTokenOwner.getAddress()
          );

        seller.assistant = await other3.getAddress();
        pendingSellerUpdate.assistant = await other3.getAddress();
        pendingSellerUpdateStruct = pendingSellerUpdate.toStruct();

        // Transfer ownership of auth token because owner must be different from old admin
        await mockAuthERC721Contract
          .connect(authTokenOwner)
          .transferFrom(await authTokenOwner.getAddress(), await other1.getAddress(), 8400);
        const newAuthTokenOwner = other1;

        // Update seller
        const tx = await accountHandler.connect(newAuthTokenOwner).updateSeller(seller, authToken);

        // Testing for the SellerUpdatePending event
        await expect(tx)
          .to.emit(accountHandler, "SellerUpdatePending")
          .withArgs(seller.id, pendingSellerUpdateStruct, emptyAuthTokenStruct, await newAuthTokenOwner.getAddress());

        sellerStruct = seller.toStruct();
        pendingSellerUpdate.assistant = ZeroAddress;
        pendingSellerUpdateStruct = pendingSellerUpdate.toStruct();

        // Approve update
        await expect(accountHandler.connect(other3).optInToSellerUpdate(seller.id, [SellerUpdateFields.Assistant]))
          .to.emit(accountHandler, "SellerUpdateApplied")
          .withArgs(
            seller.id,
            sellerStruct,
            pendingSellerUpdateStruct,
            authTokenStruct,
            emptyAuthTokenStruct,
            await other3.getAddress()
          );

        // Attempt to update the seller with original admin address, expecting revertStruct
        await expect(accountHandler.connect(admin).updateSeller(seller, authToken)).to.revertedWith(
          RevertReasons.NOT_ADMIN
        );
      });

      it("should be possible to use non-unique treasury address", async function () {
        seller2 = seller.clone();
        seller2.id = accountId.next().value;
        seller2.treasury = await other2.getAddress();

        seller.assistant = await other1.getAddress();
        seller.admin = await other1.getAddress();

        pendingSellerUpdate = seller.clone();
        pendingSellerUpdate.active = false;
        pendingSellerUpdate.id = "0";
        pendingSellerUpdate.treasury = ZeroAddress;
        pendingSellerUpdate.metadataUri = "";
        pendingSellerUpdateStruct = pendingSellerUpdate.toStruct();

        // Update seller
        const tx = await accountHandler.connect(admin).updateSeller(seller, emptyAuthToken);

        // Testing for the SellerUpdatePending event
        await expect(tx)
          .to.emit(accountHandler, "SellerUpdatePending")
          .withArgs(seller.id, pendingSellerUpdateStruct, emptyAuthTokenStruct, await admin.getAddress());

        //Create struct again with new addresses
        sellerStruct = seller.toStruct();

        // Approve update
        await accountHandler
          .connect(other1)
          .optInToSellerUpdate(seller.id, [SellerUpdateFields.Assistant, SellerUpdateFields.Admin]);

        // Make sure seller treasury didn't change
        [, sellerStruct, authTokenStruct] = await accountHandler.connect(rando).getSeller(seller.id);
        let returnedSeller = Seller.fromStruct(sellerStruct);
        expect(returnedSeller.treasury).to.equal(await treasury.getAddress());

        // Create seller 2
        await accountHandler.connect(admin).createSeller(seller2, emptyAuthToken, voucherInitValues);

        // Update seller 2 treasury
        seller2.treasury = await treasury.getAddress();
        await accountHandler.connect(admin).updateSeller(seller2, emptyAuthToken);

        // Check seller 2 treasury
        [, sellerStruct, authTokenStruct] = await accountHandler.connect(rando).getSeller(seller2.id);
        let returnedSeller2 = Seller.fromStruct(sellerStruct);
        expect(returnedSeller2.treasury).to.equal(await treasury.getAddress());
      });

      it("should be possible to use the same address for assistant, admin and treasury", async function () {
        // Only treasury doesn't need owner approval and will be updated immediately
        seller.treasury = await other1.getAddress();
        sellerStruct = seller.toStruct();

        seller.assistant = await other1.getAddress();
        seller.admin = await other1.getAddress();

        // Update seller
        const tx = await accountHandler.connect(admin).updateSeller(seller, emptyAuthToken);

        // Pending seller is filled with only admin and assistant addresses
        pendingSellerUpdate = seller.clone();
        pendingSellerUpdate.id = "0";
        pendingSellerUpdate.active = false;
        pendingSellerUpdate.treasury = ZeroAddress;
        pendingSellerUpdate.metadataUri = "";
        pendingSellerUpdateStruct = pendingSellerUpdate.toStruct();

        // Testing for the SellerUpdateApplied event
        await expect(tx)
          .to.emit(accountHandler, "SellerUpdateApplied")
          .withArgs(
            seller.id,
            sellerStruct,
            pendingSellerUpdateStruct,
            emptyAuthTokenStruct,
            emptyAuthTokenStruct,
            await admin.getAddress()
          );

        // Testing for the SellerUpdatePending event
        await expect(tx)
          .to.emit(accountHandler, "SellerUpdatePending")
          .withArgs(seller.id, pendingSellerUpdateStruct, emptyAuthTokenStruct, await admin.getAddress());

        sellerStruct = seller.toStruct();
        // Nothing pending left
        pendingSellerUpdate.admin = ZeroAddress;
        pendingSellerUpdate.clerk = ZeroAddress;
        pendingSellerUpdate.assistant = ZeroAddress;
        pendingSellerUpdateStruct = pendingSellerUpdate.toStruct();

        // Approve update
        await expect(
          await accountHandler
            .connect(other1)
            .optInToSellerUpdate(seller.id, [SellerUpdateFields.Assistant, SellerUpdateFields.Admin])
        )
          .to.emit(accountHandler, "SellerUpdateApplied")
          .withArgs(
            seller.id,
            sellerStruct,
            pendingSellerUpdateStruct,
            emptyAuthTokenStruct,
            emptyAuthTokenStruct,
            await other1.getAddress()
          );
      });

      context("💔 Revert Reasons", async function () {
        it("The sellers region of protocol is paused", async function () {
          // Pause the sellers region of the protocol
          await pauseHandler.connect(pauser).pause([PausableRegion.Sellers]);

          // Attempt to update a seller expecting revert
          await expect(accountHandler.connect(admin).updateSeller(seller, emptyAuthToken)).to.revertedWith(
            RevertReasons.REGION_PAUSED
          );
        });

        it("Seller does not exist", async function () {
          // Set invalid id
          seller.id = "444";

          // Attempt to update the seller, expecting revert
          await expect(accountHandler.connect(admin).updateSeller(seller, emptyAuthToken)).to.revertedWith(
            RevertReasons.NO_SUCH_SELLER
          );

          // Set invalid id
          seller.id = "0";

          // Attempt to update the seller, expecting revert
          await expect(accountHandler.connect(admin).updateSeller(seller, emptyAuthToken)).to.revertedWith(
            RevertReasons.NO_SUCH_SELLER
          );
        });

        it("Caller is not seller admin", async function () {
          // Attempt to update the seller, expecting revert
          await expect(accountHandler.connect(rando).updateSeller(seller, emptyAuthToken)).to.revertedWith(
            RevertReasons.NOT_ADMIN
          );
        });

        it("addresses are the zero address", async function () {
          seller.assistant = ZeroAddress;
          seller.treasury = ZeroAddress;

          // Attempt to update a seller, expecting revert
          await expect(accountHandler.connect(authTokenOwner).updateSeller(seller, emptyAuthToken)).to.revertedWith(
            RevertReasons.INVALID_ADDRESS
          );
        });

        it("Assistant is the zero address", async function () {
          seller.assistant = ZeroAddress;

          // Attempt to update a seller, expecting revert
          await expect(accountHandler.connect(authTokenOwner).updateSeller(seller, emptyAuthToken)).to.revertedWith(
            RevertReasons.INVALID_ADDRESS
          );
        });

        it("Clerk is not a zero address", async function () {
          seller.clerk = await rando.getAddress();

          // Attempt to update a seller, expecting revert
          await expect(accountHandler.connect(authTokenOwner).updateSeller(seller, emptyAuthToken)).to.revertedWith(
            RevertReasons.CLERK_DEPRECATED
          );
        });

        it("Treasury is the zero address", async function () {
          seller.treasury = ZeroAddress;

          // Attempt to update a seller, expecting revert
          await expect(accountHandler.connect(authTokenOwner).updateSeller(seller, emptyAuthToken)).to.revertedWith(
            RevertReasons.INVALID_ADDRESS
          );
        });

        it("addresses are not unique to this seller Id when addresses used for same role", async function () {
          seller.id = accountId.next().value;
          seller.assistant = await other1.getAddress();
          seller.admin = await other1.getAddress();
          seller.treasury = await other1.getAddress();
          seller.active = true;
          sellerStruct = seller.toStruct();
          expectedCloneAddress = calculateContractAddress(await accountHandler.getAddress(), "2");

          //Create second seller
          await expect(accountHandler.connect(other1).createSeller(seller, emptyAuthToken, voucherInitValues))
            .to.emit(accountHandler, "SellerCreated")
            .withArgs(seller.id, sellerStruct, expectedCloneAddress, emptyAuthTokenStruct, await other1.getAddress());

          //Set assistant address value to be same as first seller created in Seller Methods beforeEach
          seller.assistant = await assistant.getAddress(); //already being used by seller 1

          // Attempt to update seller 2 with non-unique assistant, expecting revert
          await expect(accountHandler.connect(other1).updateSeller(seller, emptyAuthToken)).to.revertedWith(
            RevertReasons.SELLER_ADDRESS_MUST_BE_UNIQUE
          );

          seller.admin = await admin.getAddress(); //already being used by seller 1
          seller.assistant = await other1.getAddress();

          // Attempt to update a seller with non-unique admin, expecting revert
          await expect(accountHandler.connect(other1).updateSeller(seller, emptyAuthToken)).to.revertedWith(
            RevertReasons.SELLER_ADDRESS_MUST_BE_UNIQUE
          );
        });

        it("addresses are not unique to this seller Id when address used for different role", async function () {
          seller.id = accountId.next().value;
          seller.assistant = await other1.getAddress();
          seller.admin = await other1.getAddress();
          seller.treasury = await other1.getAddress();
          seller.active = true;
          sellerStruct = seller.toStruct();
          expectedCloneAddress = calculateContractAddress(await accountHandler.getAddress(), "2");

          //Create second seller
          await expect(accountHandler.connect(other1).createSeller(seller, emptyAuthToken, voucherInitValues))
            .to.emit(accountHandler, "SellerCreated")
            .withArgs(seller.id, sellerStruct, expectedCloneAddress, emptyAuthTokenStruct, await other1.getAddress());

          //Set seller 2's admin address to seller 1's assistant address
          seller.admin = await assistant.getAddress();

          // Attempt to update seller 2 with non-unique assistant, expecting revert
          await expect(accountHandler.connect(other1).updateSeller(seller, emptyAuthToken)).to.revertedWith(
            RevertReasons.SELLER_ADDRESS_MUST_BE_UNIQUE
          );

          //Set seller 2's assistant address to seller 1's admin address
          seller.admin = await other1.getAddress();
          seller.assistant = await admin.getAddress();

          // Attempt to update a seller with non-unique admin, expecting revert
          await expect(accountHandler.connect(other1).updateSeller(seller, emptyAuthToken)).to.revertedWith(
            RevertReasons.SELLER_ADDRESS_MUST_BE_UNIQUE
          );
        });

        it("admin address is NOT zero address and AuthTokenType is NOT None", async function () {
          // Attempt to update a seller, expecting revert
          await expect(accountHandler.connect(admin).updateSeller(seller, authToken)).to.revertedWith(
            RevertReasons.ADMIN_OR_AUTH_TOKEN
          );
        });

        it("admin address is zero address and AuthTokenType is None", async function () {
          seller.admin = ZeroAddress;

          // Attempt to Create a seller, expecting revert
          await expect(accountHandler.connect(admin).updateSeller(seller, emptyAuthToken)).to.revertedWith(
            RevertReasons.ADMIN_OR_AUTH_TOKEN
          );
        });

        it("authToken is not unique to this seller", async function () {
          // Set admin == zero address because seller will be updated with auth token
          seller.admin = ZeroAddress;

          // Update seller 1 to have auth token
          await accountHandler.connect(admin).updateSeller(seller, authToken);

          await accountHandler.connect(authTokenOwner).optInToSellerUpdate(seller.id, [SellerUpdateFields.AuthToken]);

          //Set seller 2's auth token to empty
          seller2 = mockSeller(
            await other1.getAddress(),
            await other1.getAddress(),
            ZeroAddress,
            await other1.getAddress()
          );
          expect(seller2.isValid()).is.true;

          // Create a seller with auth token
          await accountHandler.connect(other1).createSeller(seller2, emptyAuthToken, voucherInitValues);

          seller2.admin = ZeroAddress;

          // Attempt to update seller2 with non-unique authToken used by seller 1
          await expect(accountHandler.connect(other1).updateSeller(seller2, authToken)).to.revertedWith(
            RevertReasons.AUTH_TOKEN_MUST_BE_UNIQUE
          );
        });

        it("authTokenType is Custom", async function () {
          // Set admin == zero address because seller will be created with auth token
          seller.admin = ZeroAddress;

          authToken.tokenType = AuthTokenType.Custom;

          // Attempt to Update a seller with AuthTokenType == Custom, expecting revert
          await expect(accountHandler.connect(authTokenOwner).updateSeller(seller, authToken)).to.revertedWith(
            RevertReasons.INVALID_AUTH_TOKEN_TYPE
          );
        });

        it("seller is not owner of auth token currently stored for seller", async function () {
          const authTokenOwner = other1;
          //Create seller 2 with auth token
          seller2 = mockSeller(await other1.getAddress(), ZeroAddress, ZeroAddress, await other1.getAddress());
          expect(seller2.isValid()).is.true;

          //Create auth token for token Id that seller does not own
          authToken2 = new AuthToken("0", AuthTokenType.ENS);
          expect(authToken2.isValid()).is.true;

          // Create a seller with auth token
          await mockAuthERC721Contract2.connect(authTokenOwner).mint(0, 2);

          await accountHandler.connect(authTokenOwner).createSeller(seller2, authToken2, voucherInitValues);

          //Transfer the token to a different address
          await mockAuthERC721Contract2
            .connect(authTokenOwner)
            .transferFrom(await authTokenOwner.getAddress(), await other7.getAddress(), 0);

          // Attempt to update seller2 for token that seller doesn't own
          await expect(accountHandler.connect(authTokenOwner).updateSeller(seller2, authToken2)).to.revertedWith(
            RevertReasons.NOT_ADMIN
          );
        });

        it("auth token id does not exist", async function () {
          const authTokenOwner = other1;

          //Create seller 2 with auth token
          seller2 = mockSeller(await other1.getAddress(), ZeroAddress, ZeroAddress, await other1.getAddress());
          expect(seller2.isValid()).is.true;

          //Create auth token for token Id that seller does not own
          authToken2 = new AuthToken("0", AuthTokenType.ENS);
          expect(authToken2.isValid()).is.true;

          // Attempt to update seller2 for token Id that doesn't exist
          await expect(
            accountHandler.connect(authTokenOwner).createSeller(seller2, authToken2, voucherInitValues)
          ).to.revertedWith(RevertReasons.ERC721_NON_EXISTENT);
        });

        it("No updates applied or set to pending", async function () {
          await expect(accountHandler.connect(admin).updateSeller(seller, emptyAuthToken)).to.revertedWith(
            RevertReasons.NO_UPDATE_APPLIED
          );
        });
      });
    });

    context("👉 optInToSellerUpdate()", function () {
      beforeEach(async function () {
        pendingSellerUpdate = seller.clone();
        pendingSellerUpdate.id = "0";
        pendingSellerUpdate.treasury = ZeroAddress;
        pendingSellerUpdate.clerk = ZeroAddress;
        pendingSellerUpdate.admin = ZeroAddress;
        pendingSellerUpdate.assistant = ZeroAddress;
        pendingSellerUpdate.active = false;
        pendingSellerUpdate.metadataUri = "";
        pendingSellerUpdateStruct = pendingSellerUpdate.toStruct();

        await accountHandler.connect(admin).createSeller(seller, emptyAuthToken, voucherInitValues);
      });

      it("New assistant should opt-in to update seller", async function () {
        seller.assistant = await other1.getAddress();
        sellerStruct = seller.toStruct();

        await accountHandler.connect(admin).updateSeller(seller, emptyAuthToken);

        await expect(accountHandler.connect(other1).optInToSellerUpdate(seller.id, [SellerUpdateFields.Assistant]))
          .to.emit(accountHandler, "SellerUpdateApplied")
          .withArgs(
            seller.id,
            sellerStruct,
            pendingSellerUpdateStruct,
            emptyAuthTokenStruct,
            emptyAuthTokenStruct,
            await other1.getAddress()
          );
      });

      it("New admin should opt-in to update seller", async function () {
        seller.admin = await other1.getAddress();
        sellerStruct = seller.toStruct();

        await accountHandler.connect(admin).updateSeller(seller, emptyAuthToken);

        await expect(accountHandler.connect(other1).optInToSellerUpdate(seller.id, [SellerUpdateFields.Admin]))
          .to.emit(accountHandler, "SellerUpdateApplied")
          .withArgs(
            seller.id,
            sellerStruct,
            pendingSellerUpdateStruct,
            emptyAuthTokenStruct,
            emptyAuthTokenStruct,
            await other1.getAddress()
          );
      });

      it("Should update admin and assistant in a single call ", async function () {
        seller.admin = await other1.getAddress();
        seller.assistant = await other1.getAddress();
        sellerStruct = seller.toStruct();

        await accountHandler.connect(admin).updateSeller(seller, emptyAuthToken);

        await expect(
          accountHandler
            .connect(other1)
            .optInToSellerUpdate(seller.id, [SellerUpdateFields.Admin, SellerUpdateFields.Assistant])
        )
          .to.emit(accountHandler, "SellerUpdateApplied")
          .withArgs(
            seller.id,
            sellerStruct,
            pendingSellerUpdateStruct,
            emptyAuthTokenStruct,
            emptyAuthTokenStruct,
            await other1.getAddress()
          );
      });

      it("Should update assistant and auth token in a single call when addresses are the same ", async function () {
        seller.admin = ZeroAddress;
        seller.assistant = await authTokenOwner.getAddress();
        sellerStruct = seller.toStruct();

        await accountHandler.connect(admin).updateSeller(seller, authToken);

        await expect(
          accountHandler
            .connect(authTokenOwner)
            .optInToSellerUpdate(seller.id, [SellerUpdateFields.Assistant, SellerUpdateFields.AuthToken])
        )
          .to.emit(accountHandler, "SellerUpdateApplied")
          .withArgs(
            seller.id,
            sellerStruct,
            pendingSellerUpdateStruct,
            authTokenStruct,
            emptyAuthTokenStruct,
            await authTokenOwner.getAddress()
          );
      });

      it("New auth token owner should opt-in to update seller", async function () {
        seller.admin = ZeroAddress;
        sellerStruct = seller.toStruct();

        await accountHandler.connect(admin).updateSeller(seller, authToken);

        await expect(
          accountHandler.connect(authTokenOwner).optInToSellerUpdate(seller.id, [SellerUpdateFields.AuthToken])
        )
          .to.emit(accountHandler, "SellerUpdateApplied")
          .withArgs(
            seller.id,
            sellerStruct,
            pendingSellerUpdateStruct,
            authTokenStruct,
            emptyAuthTokenStruct,
            await authTokenOwner.getAddress()
          );
      });

      it("Auth token can be used again if it was previously removed", async function () {
        // Update a seller to use auth token
        seller.admin = ZeroAddress;
        await accountHandler.connect(admin).updateSeller(seller, authToken);
        await accountHandler.connect(authTokenOwner).optInToSellerUpdate(seller.id, [SellerUpdateFields.AuthToken]);

        // Update seller to not use auth token anymore
        seller.admin = await other1.getAddress();
        await accountHandler.connect(admin).updateSeller(seller, emptyAuthToken);
        await accountHandler.connect(other1).optInToSellerUpdate(seller.id, [SellerUpdateFields.Admin]);

        // Update back to auth token
        seller.admin = ZeroAddress;
        sellerStruct = seller.toStruct();
        await accountHandler.connect(other1).updateSeller(seller, authToken);
        await expect(
          accountHandler.connect(authTokenOwner).optInToSellerUpdate(seller.id, [SellerUpdateFields.AuthToken])
        )
          .to.emit(accountHandler, "SellerUpdateApplied")
          .withArgs(
            seller.id,
            sellerStruct,
            pendingSellerUpdateStruct,
            authTokenStruct,
            emptyAuthTokenStruct,
            await authTokenOwner.getAddress()
          );
      });

      it("If updateSeller is called twice with no optIn in between, pendingSellerUpdate is populated with the data from second call", async function () {
        seller.assistant = await other1.getAddress();

        pendingSellerUpdate = seller.clone();
        pendingSellerUpdate.id = "0";
        pendingSellerUpdate.treasury = ZeroAddress;
        pendingSellerUpdate.clerk = ZeroAddress;
        pendingSellerUpdate.admin = ZeroAddress;
        pendingSellerUpdate.active = false;
        pendingSellerUpdate.metadataUri = "";
        pendingSellerUpdateStruct = pendingSellerUpdate.toStruct();

        await expect(accountHandler.connect(admin).updateSeller(seller, emptyAuthToken))
          .to.emit(accountHandler, "SellerUpdatePending")
          .withArgs(seller.id, pendingSellerUpdateStruct, emptyAuthTokenStruct, await admin.getAddress());

        seller.assistant = await other2.getAddress();
        sellerStruct = seller.toStruct();

        const pendingSellerUpdate2 = pendingSellerUpdate.clone();
        pendingSellerUpdate2.assistant = ZeroAddress;
        const pendingSellerUpdate2Struct = pendingSellerUpdate2.toStruct();

        await accountHandler.connect(admin).updateSeller(seller, emptyAuthToken);

        await expect(
          accountHandler.connect(other1).optInToSellerUpdate(seller.id, [SellerUpdateFields.Assistant])
        ).to.revertedWith(RevertReasons.UNAUTHORIZED_CALLER_UPDATE);

        await expect(accountHandler.connect(other2).optInToSellerUpdate(seller.id, [SellerUpdateFields.Assistant]))
          .to.emit(accountHandler, "SellerUpdateApplied")
          .withArgs(
            seller.id,
            sellerStruct,
            pendingSellerUpdate2Struct,
            emptyAuthTokenStruct,
            emptyAuthTokenStruct,
            await other2.getAddress()
          );

        // Set admin == zero address because seller will be created with auth token
        seller.admin = ZeroAddress;
        sellerStruct = seller.toStruct();

        await expect(accountHandler.connect(admin).updateSeller(seller, authToken))
          .to.emit(accountHandler, "SellerUpdatePending")
          .withArgs(seller.id, pendingSellerUpdate2Struct, authTokenStruct, await admin.getAddress());

        // Set different token Id, keeping auth token type the same
        const authToken2 = authToken.clone();
        authToken2.tokenId = 8500;
        const authToken2Struct = authToken2.toStruct();

        // mint the token
        await mockAuthERC721Contract.connect(rando).mint(authToken2.tokenId, 1);

        await expect(accountHandler.connect(admin).updateSeller(seller, authToken2))
          .to.emit(accountHandler, "SellerUpdatePending")
          .withArgs(seller.id, pendingSellerUpdate2Struct, authToken2Struct, await admin.getAddress());

        await expect(
          accountHandler.connect(authTokenOwner).optInToSellerUpdate(seller.id, [SellerUpdateFields.AuthToken])
        ).to.revertedWith(RevertReasons.UNAUTHORIZED_CALLER_UPDATE);

        await expect(accountHandler.connect(rando).optInToSellerUpdate(seller.id, [SellerUpdateFields.AuthToken]))
          .to.emit(accountHandler, "SellerUpdateApplied")
          .withArgs(
            seller.id,
            sellerStruct,
            pendingSellerUpdate2Struct,
            authToken2Struct,
            emptyAuthTokenStruct,
            await rando.getAddress()
          );
      });

      it("Should not emit 'SellerUpdateApplied' event if caller doesn't specify any field", async function () {
        seller.assistant = await other1.getAddress();
        await accountHandler.connect(admin).updateSeller(seller, emptyAuthToken);

        await expect(accountHandler.connect(other1).optInToSellerUpdate(seller.id, [])).to.not.emit(
          accountHandler,
          "SellerUpdateApplied"
        );
      });

      it("Should not emit 'SellerUpdateApplied'event if there is no pending update for specified field", async function () {
        seller.assistant = await other1.getAddress();
        await accountHandler.connect(admin).updateSeller(seller, emptyAuthToken);

        await expect(
          accountHandler.connect(other1).optInToSellerUpdate(seller.id, [SellerUpdateFields.Admin])
        ).to.not.emit(accountHandler, "SellerUpdateApplied");
      });

      context("💔 Revert Reasons", async function () {
        it("There are no pending updates", async function () {
          seller.admin = await other1.getAddress();
          seller.assistant = await other1.getAddress();
          sellerStruct = seller.toStruct();

          // No pending update auth token
          await accountHandler.connect(admin).updateSeller(seller, emptyAuthToken);

          await expect(
            accountHandler
              .connect(other1)
              .optInToSellerUpdate(seller.id, [SellerUpdateFields.Admin, SellerUpdateFields.Assistant])
          )
            .to.emit(accountHandler, "SellerUpdateApplied")
            .withArgs(
              seller.id,
              sellerStruct,
              pendingSellerUpdateStruct,
              emptyAuthTokenStruct,
              emptyAuthTokenStruct,
              await other1.getAddress()
            );

          await expect(accountHandler.connect(other1).optInToSellerUpdate(seller.id, [])).to.revertedWith(
            RevertReasons.NO_PENDING_UPDATE_FOR_ACCOUNT
          );
        });

        it("authToken is not unique to this seller", async function () {
          // Set admin == zero address because seller will be created with auth token
          seller.admin = ZeroAddress;

          // Request auth token update for seller 1
          await accountHandler.connect(admin).updateSeller(seller, authToken);

          await mockAuthERC721Contract
            .connect(authTokenOwner)
            .transferFrom(await authTokenOwner.getAddress(), await rando.getAddress(), 8400);

          const newAuthTokenOwner = rando;
          seller2 = mockSeller(
            await newAuthTokenOwner.getAddress(),
            ZeroAddress,
            ZeroAddress,
            await newAuthTokenOwner.getAddress()
          );
          expect(seller2.isValid()).is.true;

          // Create seller 2 with the same auth token
          await accountHandler.connect(newAuthTokenOwner).createSeller(seller2, authToken, voucherInitValues);

          // Attempt to update seller1 with non-unique authToken used by seller 2
          await expect(
            accountHandler.connect(newAuthTokenOwner).optInToSellerUpdate(seller.id, [SellerUpdateFields.AuthToken])
          ).to.revertedWith(RevertReasons.AUTH_TOKEN_MUST_BE_UNIQUE);
        });

        it("Caller is not the new admin", async function () {
          seller.admin = await other1.getAddress();

          await accountHandler.connect(admin).updateSeller(seller, emptyAuthToken);

          await expect(
            accountHandler.connect(other2).optInToSellerUpdate(seller.id, [SellerUpdateFields.Admin])
          ).to.revertedWith(RevertReasons.UNAUTHORIZED_CALLER_UPDATE);
        });

        it("Caller is not the new assistant", async function () {
          seller.assistant = await other1.getAddress();

          await accountHandler.connect(admin).updateSeller(seller, emptyAuthToken);

          await expect(
            accountHandler.connect(other2).optInToSellerUpdate(seller.id, [SellerUpdateFields.Assistant])
          ).to.revertedWith(RevertReasons.UNAUTHORIZED_CALLER_UPDATE);
        });

        it("Should revert if the caller is not the new auth token owner", async function () {
          seller.admin = ZeroAddress;

          await accountHandler.connect(admin).updateSeller(seller, authToken);

          await expect(
            accountHandler.connect(other2).optInToSellerUpdate(seller.id, [SellerUpdateFields.AuthToken])
          ).to.revertedWith(RevertReasons.UNAUTHORIZED_CALLER_UPDATE);
        });

        it("The sellers region of protocol is paused", async function () {
          seller.assistant = await other1.getAddress();

          await accountHandler.connect(admin).updateSeller(seller, emptyAuthToken);

          // Pause the sellers region of the protocol
          await pauseHandler.connect(pauser).pause([PausableRegion.Sellers]);

          await expect(accountHandler.connect(rando).optInToSellerUpdate(seller.id, [])).to.revertedWith(
            RevertReasons.REGION_PAUSED
          );
        });

        it("Admin is not unique to this seller", async function () {
          // Update seller admin
          seller.admin = await other1.getAddress();
          await accountHandler.connect(admin).updateSeller(seller, emptyAuthToken);

          // Create seller with same admin
          seller2 = mockSeller(
            await other1.getAddress(),
            await other1.getAddress(),
            ZeroAddress,
            await other1.getAddress()
          );
          expect(seller2.isValid()).is.true;

          await accountHandler.connect(other1).createSeller(seller2, emptyAuthToken, voucherInitValues);

          // Attempt to approve the update with non-unique admin, expecting revert
          await expect(
            accountHandler.connect(other1).optInToSellerUpdate(seller.id, [SellerUpdateFields.Admin])
          ).to.revertedWith(RevertReasons.SELLER_ADDRESS_MUST_BE_UNIQUE);
        });

        it("Assistant is not unique to this seller", async function () {
          // Update seller assistant
          seller.assistant = await other1.getAddress();
          await accountHandler.connect(admin).updateSeller(seller, emptyAuthToken);

          // Create seller with same assistant
          seller2 = mockSeller(
            await other1.getAddress(),
            await other1.getAddress(),
            ZeroAddress,
            await other1.getAddress()
          );
          expect(seller2.isValid()).is.true;

          await accountHandler.connect(other1).createSeller(seller2, emptyAuthToken, voucherInitValues);

          // Attempt to approve the update with non-unique assistant, expecting revert
          await expect(
            accountHandler.connect(other1).optInToSellerUpdate(seller.id, [SellerUpdateFields.Assistant])
          ).to.revertedWith(RevertReasons.SELLER_ADDRESS_MUST_BE_UNIQUE);
        });

        it("Seller tries to update the clerk", async function () {
          seller.assistant = await other1.getAddress();

          await accountHandler.connect(admin).updateSeller(seller, emptyAuthToken);

          await expect(
            accountHandler.connect(other2).optInToSellerUpdate(seller.id, [SellerUpdateFields.Clerk])
          ).to.revertedWith(RevertReasons.CLERK_DEPRECATED);
        });
      });
    });
  });
});
