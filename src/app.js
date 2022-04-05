const express = require('express');
const bodyParser = require('body-parser');
const {sequelize} = require('./model')
const {getProfile} = require('./middleware/getProfile')
const app = express();
const {Op} = require("sequelize");
const moment = require("moment");

app.use(bodyParser.json());
app.set('sequelize', sequelize)
app.set('models', sequelize.models)

/**
 * FIX ME!
 * @returns contract by id
 */
app.get('/contracts/:id', getProfile, async (req, res) => {
    const {Contract} = req.app.get('models')
    const {id} = req.params
    const contract = await Contract.findOne({
        where: {
            id: id,
            [Op.or]: {
                ClientId: req.profile.id,
                ContractorId: req.profile.id
            }
        }
    })
    if (!contract) return res.status(404).end()
    res.json(contract)
})

app.get('/contracts', getProfile, async (req, res) => {
    const {Contract} = req.app.get('models')
    const contracts = await Contract.findAll({
        where: {
            [Op.or]: {
                ClientId: req.profile.id,
                ContractorId: req.profile.id
            }
        }
    })
    if (!contracts) return res.status(404).end()
    res.json(contracts)
})
app.get('/jobs/unpaid', getProfile, async (req, res) => {
    const {Job} = req.app.get('models')
    const {Contract} = req.app.get('models')
    const jobs = await Job.findAll({
        where: {
            paid: null,
            '$Contract.status$': 'in_progress',
            [Op.or]: {
                '$Contract.ClientId$': req.profile.id,
                '$Contract.ContractorId$': req.profile.id
            }
        },
        include: [
            {model: Contract, as: 'Contract'},
        ]
    })
    if (!jobs) return res.status(404).end()
    res.json(jobs)
})
app.post('/jobs/:job_id/pay', getProfile, async (req, res) => {
    const {Job} = req.app.get('models')
    const {Contract, Profile} = req.app.get('models')
    const {job_id} = req.params
    const job = await Job.findOne({
        where: {
            id: job_id,
            '$Contract.Client.balance$': {
                [Op.gte]: sequelize.col('price')
            },
            [Op.or]: {
                '$Contract.ClientId$': req.profile.id,
                '$Contract.ContractorId$': req.profile.id
            }
        },
        include: [
            {
                model: Contract,
                as: 'Contract',
                include: [{model: Profile, as: 'Client'}, {model: Profile, as: 'Contractor'}]
            },
        ]
    })
    if (!job) return res.status(404).end()
    const newClientBalance = job.Contract.Client.balance - job.price;
    const newContractorBalance = job.Contract.Contractor.balance + job.price;
    job.Contract.Client.balance = newClientBalance;
    await job.Contract.Client.save();

    job.Contract.Contractor.balance = newContractorBalance;
    await job.Contract.Contractor.save();

    job.paid = (job.paid || 0) + 1;
    job.paymentDate = new Date();
    await job.save();

    res.json(job)
})
app.get('/admin/best-profession', getProfile, async (req, res) => {
    const {Job} = req.app.get('models')
    const {Profile, Contract} = req.app.get('models')
    const {start, end} = req.query
    const options = {
        where: {
            [Op.and]: {
                paid: {
                    [Op.ne]: null
                }
            }
        },
        attributes: [
            [sequelize.fn("SUM", sequelize.col("price")), "total"],
        ],
        group: 'Contract.Contractor.profession',
        include: [
            {model: Contract, as: 'Contract', include: [{model: Profile, as: 'Contractor'}]},
        ],
        limit: 1,
        order: [
            [sequelize.fn("SUM", sequelize.col("price")), 'DESC']
        ]
    };
    if (start && end) {
        options.where[Op.and].paymentDate = {
            [Op.gte]: moment(start).startOf('day'),
            [Op.lte]: moment(end).endOf('day'),
        }
    } else if (start && !end) {
        options.where[Op.and].paymentDate = {
            [Op.gte]: moment(start).startOf('day')
        }
    } else if (!start && end) {
        options.where[Op.and].paymentDate = {
            [Op.lte]: moment(end).endOf('day')
        }
    }
    const job = await Job.findAll(options)
    if (!job) return res.status(404).end()

    res.json(job[0])
})
app.get('/admin/best-clients', getProfile, async (req, res) => {
    const {Job} = req.app.get('models')
    const {Profile, Contract} = req.app.get('models')
    const {start, end, limit} = req.query
    const options = {
        where: {
            [Op.and]: {
                paid: {
                    [Op.ne]: null
                }
            }
        },
        attributes: [
            [sequelize.fn("SUM", sequelize.col("price")), "paid"],
        ],
        group: ['Contract.ClientId'],
        include: [
            {model: Contract, as: 'Contract', include: {model: Profile, as: 'Client'}},
        ],
        limit: limit || 2,
        order: [
            [sequelize.fn("SUM", sequelize.col("price")), 'DESC']
        ]
    };
    if (start && end) {
        options.where[Op.and].paymentDate = {
            [Op.gte]: moment(start).startOf('day'),
            [Op.lte]: moment(end).endOf('day'),
        }
    } else if (start && !end) {
        options.where[Op.and].paymentDate = {
            [Op.gte]: moment(start).startOf('day')
        }
    } else if (!start && end) {
        options.where[Op.and].paymentDate = {
            [Op.lte]: moment(end).endOf('day')
        }
    }
    const job = await Job.findAll(options)
    if (!job) return res.status(404).end()

    res.json(job.map(j => ({
        id: j.Contract.Client.id,
        fullName: j.Contract.Client.firstName + ' ' + j.Contract.Client.lastName,
        paid: j.paid
    })))
})
module.exports = app;
