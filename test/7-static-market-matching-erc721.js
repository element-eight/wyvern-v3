/* global artifacts:false, it:false, contract:false, assert:false */

const WyvernAtomicizer = artifacts.require('WyvernAtomicizer')
const WyvernExchange = artifacts.require('WyvernExchange')
const StaticMarket = artifacts.require('StaticMarket')
const WyvernRegistry = artifacts.require('WyvernRegistry')
const TestERC20 = artifacts.require('TestERC20')
const TestERC721 = artifacts.require('TestERC721')

const Web3 = require('web3')
const provider = new Web3.providers.HttpProvider('http://localhost:8545')
const web3 = new Web3(provider)

const {wrap,ZERO_BYTES32,CHAIN_ID,assertIsRejected} = require('./util')

contract('WyvernExchange - ERC721 test', (accounts) =>
	{
	let deploy_core_contracts = async () =>
		{
		let [registry,atomicizer] = await Promise.all([WyvernRegistry.new(), WyvernAtomicizer.new()])
		let [exchange,statici] = await Promise.all([WyvernExchange.new(CHAIN_ID,[registry.address],'0x'),StaticMarket.new()])
		await registry.grantInitialAuthentication(exchange.address)
		return {registry,exchange:wrap(exchange),atomicizer,statici}
		}

	let deploy = async contracts => Promise.all(contracts.map(contract => contract.new()))

	const erc721_for_erc20_test = async (options) =>
		{
		const {
			tokenId,
			buyTokenId,
			sellingPrice,
			buyingPrice,
			erc20MintAmount,
			account_a,
			account_b,
			sender} = options

		let {exchange, registry, statici} = await deploy_core_contracts()
		let [erc721,erc20] = await deploy([TestERC721,TestERC20])
		
		await registry.registerProxy({from: account_a})
		let proxy1 = await registry.proxies(account_a)
		assert.equal(true, proxy1.length > 0, 'no proxy address for account a')

		await registry.registerProxy({from: account_b})
		let proxy2 = await registry.proxies(account_b)
		assert.equal(true, proxy2.length > 0, 'no proxy address for account b')
		
		await Promise.all([erc721.setApprovalForAll(proxy1,true,{from: account_a}),erc20.approve(proxy2,erc20MintAmount,{from: account_b})])
		await Promise.all([erc721.mint(account_a,tokenId),erc20.mint(account_b,erc20MintAmount)])

		if (buyTokenId)
			await erc721.mint(account_a,buyTokenId)

		const erc721c = new web3.eth.Contract(erc721.abi, erc721.address)
		const erc20c = new web3.eth.Contract(erc20.abi, erc20.address)
		const selectorOne = web3.eth.abi.encodeFunctionSignature('ERC721ForERC20(bytes,address[7],uint8[2],uint256[6],bytes,bytes)')
		const selectorTwo = web3.eth.abi.encodeFunctionSignature('ERC20ForERC721(bytes,address[7],uint8[2],uint256[6],bytes,bytes)')
			
		const paramsOne = web3.eth.abi.encodeParameters(
			['address[2]', 'uint256[2]'],
			[[erc721.address, erc20.address], [tokenId, sellingPrice]]
			) 
	
		const paramsTwo = web3.eth.abi.encodeParameters(
			['address[2]', 'uint256[2]'],
			[[erc20.address, erc721.address], [buyTokenId || tokenId, buyingPrice]]
			)
		const one = {registry: registry.address, maker: account_a, staticTarget: statici.address, staticSelector: selectorOne, staticExtradata: paramsOne, maximumFill: 1, listingTime: '0', expirationTime: '10000000000', salt: '11'}
		const two = {registry: registry.address, maker: account_b, staticTarget: statici.address, staticSelector: selectorTwo, staticExtradata: paramsTwo, maximumFill: buyingPrice, listingTime: '0', expirationTime: '10000000000', salt: '12'}

		const firstData = erc721c.methods.transferFrom(account_a, account_b, tokenId).encodeABI()
		const secondData = erc20c.methods.transferFrom(account_b, account_a, buyingPrice).encodeABI()
		
		const firstCall = {target: erc721.address, howToCall: 0, data: firstData}
		const secondCall = {target: erc20.address, howToCall: 0, data: secondData}

		let sigOne = await exchange.sign(one, account_a)
		let sigTwo = await exchange.sign(two, account_b)
		await exchange.atomicMatchWith(one, sigOne, firstCall, two, sigTwo, secondCall, ZERO_BYTES32,{from: sender || account_a})
		
		let [account_a_erc20_balance,token_owner] = await Promise.all([erc20.balanceOf(account_a),erc721.ownerOf(tokenId)])
		assert.equal(account_a_erc20_balance.toNumber(), sellingPrice,'Incorrect ERC20 balance')
		assert.equal(token_owner, account_b,'Incorrect token owner')
		}

	it('StaticMarket: matches erc721 <> erc20 order',async () =>
		{
		const price = 15000

		return erc721_for_erc20_test({
			tokenId: 10,
			sellingPrice: price,
			buyingPrice: price,
			erc20MintAmount: price,
			account_a: accounts[0],
			account_b: accounts[6],
			sender: accounts[1]
			})
		})

	it('StaticMarket: does not fill erc721 <> erc20 order with different prices',async () =>
		{
		const price = 15000

		return assertIsRejected(
			erc721_for_erc20_test({
				tokenId: 10,
				sellingPrice: price,
				buyingPrice: price-1,
				erc20MintAmount: price,
				account_a: accounts[0],
				account_b: accounts[6],
				sender: accounts[1]
				}),
			/Static call failed/,
			'Order should not have matched'
			)
		})

	it('StaticMarket: does not fill erc721 <> erc20 order if the balance is insufficient',async () =>
		{
		const price = 15000

		return assertIsRejected(
			erc721_for_erc20_test({
				tokenId: 10,
				sellingPrice: price,
				buyingPrice: price,
				erc20MintAmount: price-1,
				account_a: accounts[0],
				account_b: accounts[6],
				sender: accounts[1]
				}),
			/Second call failed/,
			'Order should not have matched'
			)
		})

	it('StaticMarket: does not fill erc721 <> erc20 order if the token IDs are different',async () =>
		{
		const price = 15000

		return assertIsRejected(
			erc721_for_erc20_test({
				tokenId: 10,
				buyTokenId: 11,
				sellingPrice: price,
				buyingPrice: price,
				erc20MintAmount: price,
				account_a: accounts[0],
				account_b: accounts[6],
				sender: accounts[1]
				}),
			/Static call failed/,
			'Order should not have matched'
			)
		})
	})
