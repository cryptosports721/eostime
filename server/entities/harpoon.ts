import {BaseEntity,Column,Entity,Index,JoinColumn,JoinTable,ManyToMany,ManyToOne,OneToMany,OneToOne,PrimaryColumn,PrimaryGeneratedColumn,RelationId} from "typeorm";


@Entity("harpoon",{schema:"eostime"})
@Index("id_UNIQUE",["id",],{unique:true})
@Index("auctionId_idx",["auctionId",])
@Index("creationDatetime",["creationDatetime",])
@Index("accountName",["accountName",])
export class harpoon extends BaseEntity {

    @PrimaryGeneratedColumn({
        type:"int", 
        name:"id"
        })
    id:number;
        

    @Column("datetime",{ 
        nullable:false,
        name:"creationDatetime"
        })
    creationDatetime:Date;
        

    @Column("int",{ 
        nullable:false,
        name:"auctionId"
        })
    auctionId:number;
        

    @Column("varchar",{ 
        nullable:false,
        length:12,
        name:"accountName"
        })
    accountName:string;
        

    @Column("int",{ 
        nullable:false,
        name:"clientSeed"
        })
    clientSeed:number;
        

    @Column("varchar",{ 
        nullable:false,
        length:36,
        name:"serverSeed"
        })
    serverSeed:string;
        

    @Column("float",{ 
        nullable:false,
        precision:12,
        name:"odds"
        })
    odds:number;
        

    @Column("int",{ 
        nullable:false,
        name:"result"
        })
    result:number;
        

    @Column("tinyint",{ 
        nullable:false,
        width:1,
        default: () => "'0'",
        name:"harpoon"
        })
    harpoon:boolean;
        
}
